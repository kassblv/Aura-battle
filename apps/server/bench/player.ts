import { defaultAnimationFor, STYLES } from '@aura/content';
import { BALANCE, type Tier } from '@aura/rules';
import { io, type Socket } from 'socket.io-client';
import { PROTOCOL_VERSION } from '@aura/protocol';

/**
 * Un joueur simule, pour le banc de charge (jalon M7).
 *
 * Il joue comme le client reel : il tape pendant la recharge, verrouille un
 * choix qu'il peut payer, et envoie ses instants **relatifs au debut de
 * phase**, mesures sur sa propre horloge. C'est ce qui compte pour la charge :
 * envoyer des taps invraisemblables ferait emprunter au serveur un chemin
 * moins couteux — le moteur les ecarterait sans jamais les journaliser — et le
 * relevé serait flatteur pour de mauvaises raisons.
 *
 * Il ne cherche pas a bien jouer. Gagner ou perdre ne change ni le nombre de
 * messages ni leur cout.
 */

export interface PlayerOptions {
  readonly wsUrl: string;
  readonly token: string;
  /** Millisecondes entre deux lots de taps. Le client reel en envoie un toutes les 500 ms. */
  readonly tapBatchMs: number;
  /** Cadence de frappe. Le plafond du jeu est a 12 ; un humain rapide tient 6 a 8. */
  readonly tapsPerSecond: number;
  /** Part de la phase de choix attendue avant de verrouiller, avec un peu de dispersion. */
  readonly lockAtPct: number;
  /** Periode des `ping`, qui servent aussi de mesure d'aller-retour. */
  readonly pingMs: number;
  /** Patience accordee a une tentative de connexion, en millisecondes. */
  readonly connectTimeoutMs: number;
  /** Tentatives de connexion avant d'abandonner. */
  readonly connectAttempts: number;
}

/** Ce qu'un joueur rapporte a la fin d'un relevé. */
export interface PlayerStats {
  readonly sent: Readonly<Record<string, number>>;
  readonly received: Readonly<Record<string, number>>;
  readonly errors: Readonly<Record<string, number>>;
  readonly matchesStarted: number;
  readonly matchesEnded: number;
  readonly roundsPlayed: number;
  /** Allers-retours de `ping`, en millisecondes. */
  readonly rtt: readonly number[];
  /**
   * Retard des lots de taps sur leur horaire, en millisecondes.
   *
   * Temoin de fiabilite cote client : si le poste de mesure sature, les lots
   * partent en retard et la charge reellement offerte au serveur n'est plus
   * celle qu'on croit avoir demandee.
   */
  readonly tapLateness: readonly number[];
  readonly disconnects: number;
  /**
   * Temps mis a etablir la connexion, en millisecondes.
   *
   * Ce n'est pas une mesure de confort : `handleConnection` lit le nom et la
   * ligue du joueur dans Postgres **avant** d'enregistrer la session. Une
   * rafale de connexions est donc une rafale de requetes, et c'est le premier
   * endroit ou une montee en charge peut se casser — bien avant le premier
   * message de match.
   */
  readonly connectMs: number;
  readonly connectAttempts: number;
}

/** Orbe telle que `recharge:start` la decrit. */
interface OrbSpec {
  readonly index: number;
  readonly lifetimeMs: number;
}

/** Emplacement visible, tel que le serveur le rejouera. */
interface Slot {
  orb: OrbSpec | null;
  spawnedAtMs: number;
}

/** Le banc joue les poses offertes : tout joueur les possede. */
const poseFor = (tier: Tier): string =>
  defaultAnimationFor({ style: STYLES[Math.floor(Math.random() * STYLES.length)]!, tier });

/** Instants monotones, en millisecondes : jamais `Date.now()` pour une duree. */
const nowMs = (): number => Number(process.hrtime.bigint() / 1_000n) / 1_000;

export class BenchPlayer {
  private readonly socket: Socket;
  private readonly sent: Record<string, number> = {};
  private readonly received: Record<string, number> = {};
  private readonly errors: Record<string, number> = {};
  private readonly rtt: number[] = [];
  private readonly tapLateness: number[] = [];
  private readonly timers = new Set<NodeJS.Timeout>();

  private matchId: string | null = null;
  private round = 1;
  private seq = 0;
  private energy = BALANCE.match.startingEnergy;
  private matchesStarted = 0;
  private matchesEnded = 0;
  private roundsPlayed = 0;
  private disconnects = 0;
  private connectMs = 0;
  private connectAttempts = 0;
  /**
   * Le joueur joue des qu'il existe.
   *
   * Attendre le signal de mesure pour taper laisserait les matchs de la montee
   * en charge se derouler a vide — action par defaut de chaque cote, manches
   * expirees — et le regime etabli qu'on veut mesurer n'aurait jamais lieu.
   */
  private running = true;
  private stopped = false;

  /** Etat de la recharge en cours : ce que le joueur croit voir a l'ecran. */
  private slots: Slot[] = [];
  private sequence: OrbSpec[] = [];
  private nextOrb = 0;

  /** Appelé quand le match se termine : l'orchestrateur en rouvre un. */
  onMatchEnded: (() => void) | null = null;

  constructor(
    readonly playerId: string,
    private readonly options: PlayerOptions,
  ) {
    /**
     * `autoConnect: false`, et ce n'est pas un detail de style.
     *
     * Une socket qui se connecte des sa construction emet son `connect_error`
     * **avant** que qui que ce soit n'ecoute : mille sockets creees d'un coup,
     * puis attendues huit par huit, et l'erreur de la centieme est perdue
     * depuis longtemps quand vient son tour. Le banc attendait alors
     * indefiniment un evenement deja passe — il s'est bloque a 940 connexions
     * sur 1000, serveur a 3 % de processeur, sans le moindre message d'erreur.
     *
     * Differer la connexion rend du meme coup sa limite de parallelisme
     * effective : `--connect-concurrency` commande enfin la cadence d'ouverture
     * au lieu de la subir.
     */
    this.socket = io(options.wsUrl, {
      transports: ['websocket'],
      auth: { token: options.token, protocolVersion: PROTOCOL_VERSION },
      forceNew: true,
      reconnection: false,
      autoConnect: false,
      timeout: options.connectTimeoutMs,
    });
    this.bind();
  }

  /**
   * Attend la connexion, en reessayant.
   *
   * Une tentative ratee n'est pas forcement un defaut du serveur : mille
   * poignees de main lancees ensemble en depassent la patience. Reessayer
   * permet de distinguer « le serveur ne repond plus » de « on a demande trop
   * vite », et le nombre de tentatives est publie pour que la difference se
   * lise dans le relevé au lieu de se deviner.
   */
  async connected(): Promise<void> {
    const startedAt = nowMs();
    for (let attempt = 1; attempt <= this.options.connectAttempts; attempt += 1) {
      this.connectAttempts = attempt;
      if (this.socket.connected) break;
      try {
        await this.attemptConnection();
        break;
      } catch (cause) {
        if (attempt === this.options.connectAttempts) throw cause;
        await new Promise<void>((resolve) => setTimeout(resolve, 250 * attempt));
      }
    }
    this.connectMs = nowMs() - startedAt;
  }

  /** Une tentative : on ecoute d'abord, on compose ensuite. */
  private attemptConnection(): Promise<void> {
    return new Promise((resolve, reject) => {
      const onConnect = (): void => {
        this.socket.off('connect_error', onError);
        resolve();
      };
      const onError = (cause: Error): void => {
        this.socket.off('connect', onConnect);
        reject(cause);
      };
      this.socket.once('connect', onConnect);
      this.socket.once('connect_error', onError);
      this.socket.connect();
    });
  }

  /** Demarre les `ping`, qui servent aussi de mesure d'aller-retour. */
  start(): void {
    this.every(this.options.pingMs, () => {
      this.send('ping', { t: Date.now() });
    });
  }

  /**
   * Repart de compteurs vides, au debut de la fenetre de mesure.
   *
   * Le pendant exact de la remise a zero cote serveur : sans elle, les
   * comptes du client couvriraient aussi la montee en charge, et les deux
   * bouts du banc ne parleraient pas de la meme fenetre.
   */
  beginMeasurement(): void {
    for (const counter of [this.sent, this.received, this.errors]) {
      for (const key of Object.keys(counter)) delete counter[key];
    }
    this.rtt.length = 0;
    this.tapLateness.length = 0;
    this.matchesStarted = 0;
    this.matchesEnded = 0;
    this.roundsPlayed = 0;
    this.disconnects = 0;
  }

  /** Ouvre une invitation, et rend le code a dicter a l'autre siege. */
  createInvite(): Promise<string> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error(`invitation sans reponse pour ${this.playerId}`));
      }, 20_000);
      this.socket.once('invite:created', (invite: { code: string }) => {
        clearTimeout(timer);
        resolve(invite.code);
      });
      this.send('invite:create', {});
    });
  }

  joinInvite(code: string): void {
    this.send('invite:join', { code });
  }

  joinQueue(mode: 'ranked' | 'casual'): void {
    this.send('queue:join', { mode });
  }

  /** Attend d'etre assis a un match, ou renonce. */
  seated(timeoutMs = 60_000): Promise<void> {
    if (this.matchId !== null) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error(`${this.playerId} n'a jamais ete assis`));
      }, timeoutMs);
      this.socket.once('match:found', () => {
        clearTimeout(timer);
        resolve();
      });
    });
  }

  stats(): PlayerStats {
    return {
      sent: { ...this.sent },
      received: { ...this.received },
      errors: { ...this.errors },
      matchesStarted: this.matchesStarted,
      matchesEnded: this.matchesEnded,
      roundsPlayed: this.roundsPlayed,
      rtt: [...this.rtt],
      tapLateness: [...this.tapLateness],
      disconnects: this.disconnects,
      connectMs: this.connectMs,
      connectAttempts: this.connectAttempts,
    };
  }

  stop(): void {
    this.stopped = true;
    this.running = false;
    for (const timer of this.timers) clearTimeout(timer);
    this.timers.clear();
    this.socket.disconnect();
  }

  private bind(): void {
    this.socket.onAny((name: string) => {
      this.received[name] = (this.received[name] ?? 0) + 1;
    });

    this.socket.on('disconnect', () => {
      this.disconnects += 1;
    });

    this.socket.on('error', (payload: { code?: string }) => {
      const code = payload.code ?? 'INCONNU';
      this.errors[code] = (this.errors[code] ?? 0) + 1;
    });

    this.socket.on('pong', (payload: { t: number }) => {
      this.rtt.push(Date.now() - payload.t);
    });

    this.socket.on('match:found', (found: { matchId: string }) => {
      this.matchId = found.matchId;
      this.seq = 0;
      this.energy = BALANCE.match.startingEnergy;
      this.matchesStarted += 1;
      this.send('match:ready', { matchId: found.matchId });
    });

    this.socket.on('round:intro', (intro: { round: number; energy: number }) => {
      this.round = intro.round;
      this.energy = intro.energy;
    });

    this.socket.on(
      'recharge:start',
      (start: { matchId: string; round: number; orbs: readonly OrbSpec[] }) => {
        this.round = start.round;
        this.beginRecharge(start.orbs);
      },
    );

    this.socket.on('choice:start', (start: { round: number; endsAt: number; energy: number }) => {
      this.round = start.round;
      this.energy = start.energy;
      this.scheduleLock(start.endsAt);
    });

    this.socket.on('round:result', () => {
      this.roundsPlayed += 1;
    });

    this.socket.on('match:end', () => {
      this.matchId = null;
      this.matchesEnded += 1;
      this.onMatchEnded?.();
    });
  }

  /**
   * Rejoue la scene de recharge comme le client, puis tape dedans.
   *
   * Le client doit tenir les trois emplacements visibles lui-meme : le serveur
   * n'envoie que la sequence, et c'est le jeu du joueur qui decide laquelle des
   * orbes est a l'ecran a un instant donne. Sans ce suivi, chaque tap
   * designerait une orbe absente — le serveur les compterait comme impossibles
   * et le banc mesurerait un chemin que personne n'emprunte.
   */
  private beginRecharge(orbs: readonly OrbSpec[]): void {
    this.sequence = [...orbs];
    this.slots = [];
    this.nextOrb = 0;
    for (let i = 0; i < BALANCE.recharge.visibleOrbs; i += 1) {
      this.slots.push({ orb: this.sequence[this.nextOrb] ?? null, spawnedAtMs: 0 });
      this.nextOrb += 1;
    }

    const startedAt = nowMs();
    const batchMs = this.options.tapBatchMs;
    const gapMs = 1_000 / this.options.tapsPerSecond;
    const duration = BALANCE.recharge.durationMs;
    let nextTapAt = gapMs;

    const sendBatch = (scheduledAt: number): void => {
      if (!this.running || this.matchId === null) return;
      const elapsed = nowMs() - startedAt;
      this.tapLateness.push(elapsed - scheduledAt);

      const taps: { orbIndex: number | null; t: number }[] = [];
      while (nextTapAt <= elapsed && nextTapAt <= duration) {
        taps.push({ orbIndex: this.aimAt(nextTapAt), t: Math.round(nextTapAt) });
        nextTapAt += gapMs;
      }

      if (taps.length > 0) {
        this.send('recharge:taps', {
          matchId: this.matchId,
          round: this.round,
          seq: (this.seq += 1),
          taps,
        });
      }

      if (elapsed + batchMs <= duration) {
        this.after(batchMs, () => {
          sendBatch(scheduledAt + batchMs);
        });
      }
    };

    this.after(batchMs, () => {
      sendBatch(batchMs);
    });
  }

  /** Vise une orbe vivante a cet instant, ou tape dans le vide. */
  private aimAt(atMs: number): number | null {
    for (const slot of this.slots) {
      if (slot.orb !== null && atMs >= slot.spawnedAtMs + slot.orb.lifetimeMs) {
        slot.spawnedAtMs += slot.orb.lifetimeMs;
        slot.orb = this.sequence[this.nextOrb] ?? null;
        this.nextOrb += 1;
      }
    }

    const live = this.slots.find((slot) => slot.orb !== null);
    if (live?.orb == null) return null;

    const index = live.orb.index;
    live.orb = this.sequence[this.nextOrb] ?? null;
    live.spawnedAtMs = atMs;
    this.nextOrb += 1;
    return index;
  }

  /**
   * Verrouille un choix a portee d'energie.
   *
   * Un choix trop cher est refuse par le moteur : le serveur repondrait
   * `error` et le siege jouerait l'action par defaut. Le banc mesurerait alors
   * un match de refus, pas un match.
   */
  private scheduleLock(endsAtServerMs: number): void {
    const remaining = endsAtServerMs - Date.now();
    if (remaining <= 0) return;
    // Une dispersion de 20 % evite que mille joueurs ne verrouillent a la
    // milliseconde pres : un banc qui synchronise tout mesure une rafale
    // artificielle plutot qu'un regime etabli.
    const wait = remaining * this.options.lockAtPct * (0.8 + Math.random() * 0.4);

    this.after(wait, () => {
      if (!this.running || this.matchId === null) return;

      const budget = Math.min(this.energy, BALANCE.maxRoundCost);
      const tier = pickAffordableTier(budget);
      const amp = budget - BALANCE.tierCost[tier] >= 1 ? 1 : 0;
      const chargeAt = Math.max(0, Math.min(BALANCE.phases.choiceMs - 900, wait - 1_000));

      this.send('choice:lock', {
        matchId: this.matchId,
        round: this.round,
        seq: (this.seq += 1),
        poseId: poseFor(tier),
        amp,
        ult: false,
        timing: { chargeAt: Math.round(chargeAt), tapAt: Math.round(chargeAt + 600) },
      });
    });
  }

  private send(name: string, payload: unknown): void {
    if (this.stopped) return;
    this.sent[name] = (this.sent[name] ?? 0) + 1;
    this.socket.emit(name, payload);
  }

  private after(delayMs: number, run: () => void): void {
    const timer = setTimeout(() => {
      this.timers.delete(timer);
      run();
    }, delayMs);
    this.timers.add(timer);
  }

  private every(periodMs: number, run: () => void): void {
    const tick = (): void => {
      if (!this.running) return;
      run();
      this.after(periodMs, tick);
    };
    this.after(periodMs, tick);
  }
}

/** Le palier le plus cher que ce budget permette. */
function pickAffordableTier(budget: number): 0 | 1 | 2 | 3 | 4 {
  const tiers = [4, 3, 2, 1, 0] as const;
  for (const tier of tiers) {
    if (BALANCE.tierCost[tier] <= budget) return tier;
  }
  return 0;
}
