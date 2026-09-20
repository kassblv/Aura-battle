/**
 * Mesure du temps de traitement des messages entrants (jalon M7).
 *
 * Le critere a tenir est chiffre : 500 matchs simultanes sur un noeud, p95 de
 * traitement d'un message sous 20 ms. Le mesurer demande de compter **dans le
 * serveur** — une mesure prise depuis un client melange le reseau, la pile TCP
 * et l'ordonnancement du poste de mesure a ce qu'on veut isoler.
 *
 * Trois choix structurent ce fichier.
 *
 * 1. **On agrege, on n'enregistre pas.** Un relevé de 500 matchs produit des
 *    centaines de milliers de durees ; les garder une par une coute de la
 *    memoire et de la collecte de dechets — c'est-a-dire qu'on perturberait
 *    exactement ce qu'on mesure. Un histogramme a memoire fixe ne s'alloue
 *    jamais en cours de route.
 * 2. **Eteint par defaut.** Rien de tout ceci ne tourne sans `AURA_METRICS=1` :
 *    un serveur de production non instrumente paie un `if` par message.
 * 3. **Un temoin de fiabilite accompagne chaque relevé.** Le retard de la
 *    boucle d'evenements et le temps processeur disent si l'on a mesure le
 *    serveur ou la machine qui l'heberge. Une p95 sans ce temoin ne veut rien
 *    dire sur un poste partage.
 */

import { Injectable } from '@nestjs/common';
import {
  constants,
  monitorEventLoopDelay,
  PerformanceObserver,
  type ELDHistogram,
  type PerformanceEntry,
} from 'node:perf_hooks';

/**
 * Paliers de l'histogramme, en microsecondes.
 *
 * La resolution suit ce qu'on cherche a lire : au dixieme de microseconde pres
 * on ne saurait rien de plus, mais autour de 20 ms — le seuil du jalon — une
 * marge d'erreur de 500 us sur un percentile changerait la conclusion. D'ou
 * trois paliers : fin en dessous de la milliseconde, moyen jusqu'a 20 ms,
 * grossier au-dela, ou seule l'ampleur compte.
 */
const TIERS = [
  { from: 0, to: 1_000, step: 5, offset: 0 },
  { from: 1_000, to: 20_000, step: 50, offset: 200 },
  { from: 20_000, to: 200_000, step: 500, offset: 580 },
  { from: 200_000, to: 5_000_000, step: 25_000, offset: 940 },
] as const;

/** Nombre de paliers, sans le debordement. */
const BUCKETS = 1_132;

/**
 * Tout ce qui depasse cinq secondes tombe ici.
 *
 * Le dernier palier monte si haut pour les **taches de fond**, pas pour les
 * messages : l'ecriture d'un match acheve depasse la seconde en charge, et un
 * histogramme plafonne a 200 ms rendait alors `p95 = p99 = max`, c'est-a-dire
 * plus rien de lisible la ou il fallait justement lire.
 */
const OVERFLOW = BUCKETS;

/** Percentiles publies. `p999` attrape les a-coups qu'une p99 lisse encore. */
const REPORTED = [50, 90, 95, 99, 99.9] as const;

/** Periode d'echantillonnage du retard de boucle, en millisecondes. */
const LOOP_RESOLUTION_MS = 10;

/** Un relevé d'histogramme, en millisecondes. */
export interface DurationSnapshot {
  readonly count: number;
  readonly meanMs: number;
  readonly minMs: number;
  readonly maxMs: number;
  readonly p50Ms: number;
  readonly p90Ms: number;
  readonly p95Ms: number;
  readonly p99Ms: number;
  readonly p999Ms: number;
  /** Mesures au-dela de 200 ms : elles ne sont comptees que par leur nombre. */
  readonly overflow: number;
}

/**
 * Histogramme de durees a memoire fixe.
 *
 * `record` n'alloue rien et ne branche que deux fois : c'est ce qui permet de
 * l'appeler sur le chemin critique sans deplacer la mesure. Les percentiles
 * sont rendus par la **borne haute** du palier qui les contient — on prefere
 * annoncer un peu trop qu'un peu trop peu quand un seuil est en jeu.
 */
export class DurationHistogram {
  private readonly buckets = new Uint32Array(BUCKETS + 1);
  private count = 0;
  private sumUs = 0;
  private minUs = Number.POSITIVE_INFINITY;
  private maxUs = 0;

  record(microseconds: number): void {
    const us = microseconds < 0 ? 0 : microseconds;
    this.count += 1;
    this.sumUs += us;
    if (us < this.minUs) this.minUs = us;
    if (us > this.maxUs) this.maxUs = us;
    const bucket = indexOf(us);
    this.buckets[bucket] = this.buckets[bucket]! + 1;
  }

  reset(): void {
    this.buckets.fill(0);
    this.count = 0;
    this.sumUs = 0;
    this.minUs = Number.POSITIVE_INFINITY;
    this.maxUs = 0;
  }

  get size(): number {
    return this.count;
  }

  snapshot(): DurationSnapshot {
    const [p50, p90, p95, p99, p999] = REPORTED.map((p) => this.percentileUs(p));
    return {
      count: this.count,
      meanMs: this.count === 0 ? 0 : toMs(this.sumUs / this.count),
      minMs: this.count === 0 ? 0 : toMs(this.minUs),
      maxMs: toMs(this.maxUs),
      p50Ms: toMs(p50!),
      p90Ms: toMs(p90!),
      p95Ms: toMs(p95!),
      p99Ms: toMs(p99!),
      p999Ms: toMs(p999!),
      overflow: this.buckets[OVERFLOW]!,
    };
  }

  /**
   * Percentile en microsecondes.
   *
   * Le rang vise est `ceil(p/100 x n)`, borne a 1 : c'est la definition qui
   * rend `p100` egal au maximum et `p50` egal a la mediane haute, sans
   * interpolation entre deux paliers — interpoler inventerait une precision
   * que l'histogramme n'a pas.
   */
  percentileUs(percentile: number): number {
    if (this.count === 0) return 0;
    const rank = Math.max(1, Math.ceil((percentile / 100) * this.count));
    let seen = 0;
    for (let index = 0; index <= OVERFLOW; index += 1) {
      seen += this.buckets[index]!;
      if (seen >= rank) {
        return index === OVERFLOW ? this.maxUs : upperBoundOf(index);
      }
    }
    return this.maxUs;
  }
}

function indexOf(us: number): number {
  for (const tier of TIERS) {
    if (us < tier.to) {
      return tier.offset + Math.floor((us - tier.from) / tier.step);
    }
  }
  return OVERFLOW;
}

/** Borne haute du palier, en microsecondes. */
function upperBoundOf(index: number): number {
  for (let i = TIERS.length - 1; i >= 0; i -= 1) {
    const tier = TIERS[i]!;
    if (index >= tier.offset) {
      return tier.from + (index - tier.offset + 1) * tier.step;
    }
  }
  return 0;
}

function toMs(microseconds: number): number {
  return Math.round(microseconds) / 1_000;
}

/**
 * Nombre de messages en cours de traitement retenus par connexion.
 *
 * Un message valide dont aucun gestionnaire n'existe — `intent:show`
 * aujourd'hui — n'est jamais solde : sans borne, sa trace resterait en memoire
 * pour toute la duree de la connexion. Trente-deux suffit largement a couvrir
 * les messages decodes dans une meme lecture reseau, et l'ainé qu'on evince est
 * compte a part plutot que perdu en silence.
 */
const MAX_PENDING_PER_CONNECTION = 32;

/** Ce qu'on retient d'un message entrant entre son arrivee et sa fin de traitement. */
interface Pending {
  readonly event: string;
  readonly startedAt: bigint;
}

/** Relevé complet, tel que la route de sonde le publie. */
export interface MetricsSnapshot {
  readonly enabled: true;
  /** Duree de la fenetre de mesure, depuis la derniere remise a zero. */
  readonly windowMs: number;
  readonly messages: {
    readonly total: DurationSnapshot;
    readonly byEvent: Readonly<Record<string, DurationSnapshot>>;
    readonly handled: number;
    readonly rejected: number;
    /** Messages sans gestionnaire, jamais soldes : ils ne faussent aucun percentile. */
    readonly unsettled: number;
  };
  /** Cout du filtre d'entree seul : limite de debit puis validation de schema. */
  readonly inboundFilter: DurationSnapshot;
  /** Messages soldes sans trace d'arrivee : doit rester a zero. */
  readonly unmatched: number;
  /**
   * Taches de fond : ce qui coute du temps **sans** etre dans la fenetre d'un
   * message.
   *
   * L'ecriture d'un match acheve en est l'exemple meme. Elle ne retarde aucun
   * joueur — le resultat est deja parti — donc elle n'apparait dans aucun
   * percentile de message. Mais elle consomme une connexion Postgres, et
   * quand elle cesse d'aboutir, des matchs disparaissent sans que la moindre
   * latence ne bouge. C'est le genre de panne qu'un banc de charge doit
   * nommer, parce qu'aucun autre relevé ne la voit.
   */
  readonly tasks: Readonly<Record<string, TaskSnapshot>>;
  /**
   * Temoin de fiabilite : si la boucle traine, on mesure la machine, pas le
   * serveur. Les valeurs sont des **retards** — la periode d'echantillonnage
   * en a deja ete retranchee — donc une boucle libre annonce zero.
   */
  readonly eventLoop: {
    readonly lagMeanMs: number;
    readonly lagP50Ms: number;
    readonly lagP95Ms: number;
    readonly lagP99Ms: number;
    readonly lagMaxMs: number;
  };
  /**
   * Pauses du ramasse-miettes pendant la fenetre.
   *
   * C'est le partage qui compte : un retard de boucle explique par le
   * ramasse-miettes se soigne en allouant moins, un retard explique par du
   * travail synchrone se soigne en le decoupant. Sans ce chiffre, les deux se
   * ressemblent — et on optimise au hasard.
   */
  readonly gc: {
    readonly count: number;
    readonly totalMs: number;
    readonly maxMs: number;
    /** Part de la fenetre passee dans le ramasse-miettes. */
    readonly ratio: number;
    /** Pauses de type « majeur » : les seules qui depassent la milliseconde. */
    readonly majorCount: number;
    readonly majorMaxMs: number;
  };
  readonly process: {
    readonly cpuUserMs: number;
    readonly cpuSystemMs: number;
    /** Part de processeur consommee sur la fenetre, un coeur valant 1. */
    readonly cpuRatio: number;
    readonly rssMb: number;
    readonly heapUsedMb: number;
  };
  /** Compteurs vivants publies par les modules (matchs, minuteurs, sessions). */
  readonly gauges: Readonly<Record<string, number>>;
}

/** Relevé d'une tache de fond. */
export interface TaskSnapshot extends DurationSnapshot {
  readonly failures: number;
}

/** Ce que rend la sonde quand la mesure est eteinte. */
export interface MetricsDisabled {
  readonly enabled: false;
}

/**
 * Collecteur de mesures, partage par tout le serveur.
 *
 * Il ne connait ni Socket.IO ni NestJS : un message entrant est identifie par
 * une **cle opaque** — la connexion qui l'a apporte. C'est ce qui permet a la
 * correlation « arrivee du paquet / fin du traitement » de vivre ici plutot
 * que dans la passerelle, et de rester juste quand plusieurs messages d'une
 * meme connexion sont decodes dans la meme lecture reseau : les paquets d'une
 * connexion sont distribues dans l'ordre, une file suffit donc a les apparier.
 */
@Injectable()
export class MessageMetrics {
  private readonly total = new DurationHistogram();
  private readonly byEvent = new Map<string, DurationHistogram>();
  private readonly inboundFilter = new DurationHistogram();
  private readonly pending = new WeakMap<object, Pending[]>();
  private readonly gauges = new Map<string, () => number>();
  private readonly tasks = new Map<string, { durations: DurationHistogram; failures: number }>();

  private handled = 0;
  private rejected = 0;
  private unsettled = 0;
  private unmatched = 0;
  private loop: ELDHistogram | null = null;
  private gcObserver: PerformanceObserver | null = null;
  private gc = { count: 0, totalMs: 0, maxMs: 0, majorCount: 0, majorMaxMs: 0 };
  private windowStartedAt = 0;
  private cpuAtStart = { user: 0, system: 0 };

  constructor(readonly enabled: boolean) {
    if (!enabled) return;
    this.loop = monitorEventLoopDelay({ resolution: LOOP_RESOLUTION_MS });
    this.loop.enable();
    this.gcObserver = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) this.recordGc(entry);
    });
    this.gcObserver.observe({ entryTypes: ['gc'] });
    this.markWindowStart();
  }

  /**
   * Publie un compteur vivant, lu au moment du relevé.
   *
   * Une fonction plutot qu'une valeur : un compteur de matchs vivants n'a de
   * sens qu'a l'instant ou on le lit, et personne n'a a penser a le pousser.
   */
  registerGauge(name: string, read: () => number): void {
    this.gauges.set(name, read);
  }

  /**
   * Un message vient d'arriver, avant tout filtre.
   *
   * Appele au decodage du paquet : ce qui suit — limite de debit, validation,
   * gestionnaire — fait partie du traitement et doit donc etre compte.
   */
  received(connection: object, event: string): void {
    if (!this.enabled) return;
    const queue = this.pending.get(connection);
    if (queue === undefined) {
      this.pending.set(connection, [{ event, startedAt: process.hrtime.bigint() }]);
      return;
    }
    if (queue.length >= MAX_PENDING_PER_CONNECTION) {
      queue.shift();
      this.unsettled += 1;
    }
    queue.push({ event, startedAt: process.hrtime.bigint() });
  }

  /**
   * Chronometre une tache de fond, succes ou echec.
   *
   * L'appel reste ecrit sur le chemin meme quand la mesure est eteinte : c'est
   * une garantie qu'on mesure ce qui tourne, et non une variante instrumentee
   * de ce qui tourne. Eteinte, il ne coute qu'un test de booleen.
   */
  async observeTask<T>(name: string, run: () => Promise<T>): Promise<T> {
    if (!this.enabled) return run();
    const startedAt = process.hrtime.bigint();
    const task = this.taskFor(name);
    try {
      const result = await run();
      task.durations.record(microsecondsSince(startedAt));
      return result;
    } catch (cause) {
      task.durations.record(microsecondsSince(startedAt));
      task.failures += 1;
      throw cause;
    }
  }

  /**
   * Chronometre un travail **synchrone** nomme.
   *
   * Le pendant de `observeTask` pour ce qui ne rend pas la main. La validation
   * des messages sortants en est l'exemple : elle n'appartient a la fenetre
   * d'aucun message entrant — un `round:result` part sur une echeance de
   * phase, pas en reponse a quoi que ce soit — et c'est pourtant la moitie du
   * travail que fait la boucle.
   */
  observeSync<T>(name: string, run: () => T): T {
    if (!this.enabled) return run();
    const startedAt = process.hrtime.bigint();
    const task = this.taskFor(name);
    try {
      return run();
    } finally {
      task.durations.record(microsecondsSince(startedAt));
    }
  }

  /**
   * Cout du filtre d'entree, mesure dans sa propre pile d'appel.
   *
   * Le message en cours de filtrage est forcement le **dernier** arrive :
   * `received` puis le filtre s'executent dans la meme pile d'appel, rien ne
   * peut s'intercaler entre les deux.
   */
  recordInboundFilter(connection: object): void {
    if (!this.enabled) return;
    const queue = this.pending.get(connection);
    const current = queue?.[queue.length - 1];
    if (current === undefined) return;
    this.inboundFilter.record(microsecondsSince(current.startedAt));
  }

  /** Le filtre d'entree a refuse ce message : il n'ira pas plus loin. */
  settleRejected(connection: object, event: string): void {
    this.settle(connection, event, false);
  }

  /** Le gestionnaire de ce message a fini, succes ou echec. */
  settleHandled(connection: object, event: string): void {
    this.settle(connection, event, true);
  }

  /** Oublie une connexion fermee : rien ne doit survivre a sa socket. */
  forget(connection: object): void {
    if (!this.enabled) return;
    this.pending.delete(connection);
  }

  /**
   * Solde un message, en le retrouvant **par son nom**.
   *
   * Prendre simplement le plus ancien serait faux deux fois. Un message valide
   * sans gestionnaire (`intent:show`) resterait en tete de file et decalerait
   * tout ce qui suit ; et deux gestionnaires dont l'un attend — `queue:join`
   * interroge Redis, `ping` repond sur-le-champ — se terminent dans l'ordre
   * inverse de leur arrivee. Chercher le nom rend la mesure juste dans les
   * deux cas, et la file est bornee a trente-deux entrees : le parcours coute
   * moins que le `hrtime` qui l'encadre.
   */
  private settle(connection: object, event: string, handled: boolean): void {
    if (!this.enabled) return;
    const queue = this.pending.get(connection);
    if (queue === undefined) return;

    const index = queue.findIndex((entry) => entry.event === event);
    if (index === -1) {
      this.unmatched += 1;
      return;
    }
    const entry = queue.splice(index, 1)[0]!;

    const elapsed = microsecondsSince(entry.startedAt);
    this.total.record(elapsed);
    this.histogramFor(entry.event).record(elapsed);
    if (handled) this.handled += 1;
    else this.rejected += 1;
  }

  /**
   * Repart d'une fenetre vide.
   *
   * Indispensable a un relevé honnete : la montee en charge — mille
   * connexions, mille authentifications — n'a rien a voir avec le regime
   * etabli qu'on veut mesurer, et la melanger deplacerait tous les
   * percentiles.
   */
  reset(): void {
    if (!this.enabled) return;
    this.total.reset();
    this.byEvent.clear();
    this.inboundFilter.reset();
    this.handled = 0;
    this.rejected = 0;
    this.unsettled = 0;
    this.unmatched = 0;
    this.gc = { count: 0, totalMs: 0, maxMs: 0, majorCount: 0, majorMaxMs: 0 };
    this.tasks.clear();
    this.loop?.reset();
    this.markWindowStart();
  }

  snapshot(): MetricsSnapshot | MetricsDisabled {
    if (!this.enabled || this.loop === null) return { enabled: false };

    const windowMs = Math.max(1, Date.now() - this.windowStartedAt);
    const cpu = process.cpuUsage();
    const userMs = (cpu.user - this.cpuAtStart.user) / 1_000;
    const systemMs = (cpu.system - this.cpuAtStart.system) / 1_000;
    const memory = process.memoryUsage();

    const byEvent: Record<string, DurationSnapshot> = {};
    for (const [event, histogram] of this.byEvent) {
      byEvent[event] = histogram.snapshot();
    }

    const gauges: Record<string, number> = {};
    for (const [name, read] of this.gauges) {
      gauges[name] = read();
    }

    return {
      enabled: true,
      windowMs,
      messages: {
        total: this.total.snapshot(),
        byEvent,
        handled: this.handled,
        rejected: this.rejected,
        unsettled: this.unsettled,
      },
      inboundFilter: this.inboundFilter.snapshot(),
      unmatched: this.unmatched,
      tasks: Object.fromEntries(
        [...this.tasks].map(([name, task]) => [
          name,
          { ...task.durations.snapshot(), failures: task.failures },
        ]),
      ),
      eventLoop: {
        lagMeanMs: toLagMs(this.loop.mean),
        lagP50Ms: toLagMs(this.loop.percentile(50)),
        lagP95Ms: toLagMs(this.loop.percentile(95)),
        lagP99Ms: toLagMs(this.loop.percentile(99)),
        lagMaxMs: toLagMs(this.loop.max),
      },
      gc: {
        count: this.gc.count,
        totalMs: Math.round(this.gc.totalMs * 100) / 100,
        maxMs: Math.round(this.gc.maxMs * 100) / 100,
        ratio: Math.round((this.gc.totalMs / windowMs) * 10_000) / 10_000,
        majorCount: this.gc.majorCount,
        majorMaxMs: Math.round(this.gc.majorMaxMs * 100) / 100,
      },
      process: {
        cpuUserMs: Math.round(userMs),
        cpuSystemMs: Math.round(systemMs),
        cpuRatio: Math.round(((userMs + systemMs) / windowMs) * 100) / 100,
        rssMb: Math.round(memory.rss / 1_048_576),
        heapUsedMb: Math.round(memory.heapUsed / 1_048_576),
      },
      gauges,
    };
  }

  /**
   * Compte une pause du ramasse-miettes.
   *
   * Les pauses mineures sont innombrables et courtes ; ce sont les majeures
   * qui arretent le serveur assez longtemps pour se voir dans un percentile.
   * On garde les deux, separement.
   */
  private recordGc(entry: PerformanceEntry): void {
    this.gc.count += 1;
    this.gc.totalMs += entry.duration;
    if (entry.duration > this.gc.maxMs) this.gc.maxMs = entry.duration;

    const detail = (entry as PerformanceEntry & { detail?: { kind?: number } }).detail;
    if (detail?.kind === constants.NODE_PERFORMANCE_GC_MAJOR) {
      this.gc.majorCount += 1;
      if (entry.duration > this.gc.majorMaxMs) this.gc.majorMaxMs = entry.duration;
    }
  }

  private taskFor(name: string): { durations: DurationHistogram; failures: number } {
    const existing = this.tasks.get(name);
    if (existing !== undefined) return existing;
    const created = { durations: new DurationHistogram(), failures: 0 };
    this.tasks.set(name, created);
    return created;
  }

  private histogramFor(event: string): DurationHistogram {
    const existing = this.byEvent.get(event);
    if (existing !== undefined) return existing;
    const created = new DurationHistogram();
    this.byEvent.set(event, created);
    return created;
  }

  private markWindowStart(): void {
    this.windowStartedAt = Date.now();
    const cpu = process.cpuUsage();
    this.cpuAtStart = { user: cpu.user, system: cpu.system };
  }
}

function microsecondsSince(startedAt: bigint): number {
  return Number(process.hrtime.bigint() - startedAt) / 1_000;
}

/**
 * Retard de boucle, en millisecondes.
 *
 * `monitorEventLoopDelay` compte en nanosecondes et **inclut** sa propre
 * periode d'echantillonnage : une boucle parfaitement libre rend environ
 * 10 ms, pas zero (verifie sur Node 22). Retrancher la resolution rend la
 * grandeur qu'on veut lire — le retard — plutot qu'une constante a corriger de
 * tete a chaque relevé.
 */
function toLagMs(nanoseconds: number): number {
  const lagMs = nanoseconds / 1_000_000 - LOOP_RESOLUTION_MS;
  return lagMs <= 0 ? 0 : Math.round(lagMs * 1_000) / 1_000;
}
