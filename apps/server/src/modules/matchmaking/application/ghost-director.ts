import {
  MAX_TAPS_PER_MESSAGE,
  MIN_CHARGE_TO_TAP_MS,
  type ParsedServerMessage,
  type ServerMessage,
} from '@aura/protocol';
import {
  affordableChoice,
  BALANCE,
  isChoiceAffordable,
  rechargeTapsForCount,
  tapAtMsForDelta,
  type BalanceConfig,
  type Choice,
  type GaugeParams,
  type Move,
  type Orb,
  type RechargeTap,
  type Seat,
} from '@aura/rules';
import { describeCause } from '../../../shared/describe-cause.js';
import type { AppLog } from '../../../shared/log-port.js';
import type { GhostRecording, GhostRound } from '../domain/ghost.js';

/**
 * Rejeu d'un enregistrement, siege par siege (docs/05 § « Fantomes »).
 *
 * **Le fantome joue par les memes portes qu'un joueur.** Il ne pousse aucun
 * etat dans le moteur : il recoit `recharge:start` et `choice:start` comme un
 * client — meme sequence d'orbes, meme jauge, meme energie — puis il repond par
 * `submitTaps` et `lockChoice`, les methodes exactes qu'appelle la passerelle
 * quand un telephone parle. Il passe donc par `acceptSeq`, par le controle de
 * phase, par la confrontation entre instant declare et instant d'arrivee, et
 * par le plafond de cadence. Un enregistrement n'est que de la **donnee** : il
 * ne peut rien obtenir qu'un joueur ne puisse obtenir.
 *
 * C'est aussi pourquoi le rejeu prend son temps. Envoyer les taps d'une manche
 * des la premiere milliseconde de la recharge, c'est exactement le profil que
 * `docs/06` cherche a attraper — un adversaire qui declare six secondes de jeu
 * avant qu'elles ne se soient ecoulees. Le serveur les refuserait, et il
 * aurait raison : le fantome tape a la cadence a laquelle il a tape.
 *
 * **Il ne reagit pas a son adversaire**, et docs/05 l'assume : les choix sont
 * simultanes, donc un joueur present ne reagirait pas davantage.
 */

/**
 * Cadence d'envoi des taps, en millisecondes.
 *
 * La meme que celle d'un client honnete (voir `RATE_LIMIT` dans
 * `match.gateway.ts` : « un joueur honnete envoie ses taps toutes les 500 ms »).
 * Un fantome qui enverrait tout d'un bloc consommerait moins de messages, mais
 * ressemblerait a un bot — et serait traite comme tel par les tolerances.
 */
const GHOST_TAP_BATCH_MS = 500;

/**
 * Marge laissee avant la fin d'une phase.
 *
 * Un envoi qui arrive apres l'echeance tombe dans la phase suivante : le moteur
 * le refuse, et le refus est **impute au siege**. Le fantome cesse donc d'agir
 * un peu avant la fin, comme un client dont le dernier paquet doit encore
 * traverser le reseau.
 */
const GHOST_PHASE_GUARD_MS = 100;

/**
 * Delai entre le tap de timing declare et le verrouillage.
 *
 * Le fantome verrouille **apres** avoir laisse s'ecouler le temps qu'il declare
 * avoir charge. Sans ce delai, il annoncerait une charge de deux secondes deux
 * millisecondes apres le debut de la phase, `timingIsPlausible` le refuserait,
 * et le fantome raterait toutes ses jauges en gonflant son compteur d'instants
 * impossibles — un adversaire artificiellement mauvais, et un signal
 * d'anti-triche pollue par le serveur lui-meme.
 */
const GHOST_LOCK_MARGIN_MS = 150;

/**
 * Ecart qui signifie « ce joueur n'a pas tape ».
 *
 * `evaluateTiming` rend exactement 1 quand aucun tap n'a eu lieu (`WORST_DELTA`
 * de `@aura/rules`). Un ecart reel est toujours strictement inferieur : le
 * curseur ne peut pas s'ecarter de son centre de la jauge entiere.
 */
const NO_TAP_DELTA = 1;

/** Ce que le fantome sait faire, c'est-a-dire ce que fait un client. */
export interface GhostActions {
  acceptSeq(matchId: string, seat: Seat, seq: number): boolean;
  submitTaps(matchId: string, seat: Seat, taps: readonly RechargeTap[]): void;
  lockChoice(matchId: string, seat: Seat, choice: Choice, timingTapAtMs: number | null): void;
  /**
   * Les regles du match (evenements de la semaine, M10), `null` s'il est fini.
   * Un fantome de partie rapide joue sous la variante de SON match : payer ou
   * lancer l'Ultime selon la config normale lui ferait jouer une autre partie
   * que celle de son adversaire.
   */
  configOf(matchId: string): BalanceConfig | null;
}

/** Echeances du fantome. Meme contrat que celui des phases du match. */
export interface GhostScheduler {
  schedule(key: string, atMs: number, run: () => void): void;
  cancel(key: string): void;
}

/** Horloge serveur. Le temps entre par la, et nulle part ailleurs. */
export interface GhostClock {
  now(): number;
}

/** Un fantome assis a un match en cours. */
interface LiveGhost {
  readonly ghostPlayerId: string;
  readonly matchId: string;
  readonly seat: Seat;
  readonly recording: GhostRecording;
  readonly actions: GhostActions;
  /** Compteur d'actions, croissant, exactement comme celui d'un client. */
  seq: number;
  /** Mouvements deja joues, pour la politique d'adaptation de l'IA solo. */
  readonly playedMoves: Move[];
  /** Echeances armees, a annuler a la fin du match. */
  readonly timerKeys: Set<string>;
  timerCount: number;
}

export class GhostDirector {
  private readonly ghosts = new Map<string, LiveGhost>();

  constructor(
    private readonly scheduler: GhostScheduler,
    private readonly clock: GhostClock,
    /** Regles de repli, quand le match ne dit plus les siennes. */
    private readonly config: BalanceConfig = BALANCE,
    private readonly log: AppLog | null = null,
  ) {}

  /**
   * Prend en charge un siege fantome, juste apres l'ouverture du match.
   *
   * Rien n'est programme ici : le fantome attend `recharge:start` comme un
   * client attend l'ouverture d'une phase. Calculer les echeances d'avance
   * reviendrait a reimplementer la machine a etats du moteur, et les deux
   * finiraient par diverger d'une manche.
   */
  attach(ghost: {
    readonly ghostPlayerId: string;
    readonly matchId: string;
    readonly seat: Seat;
    readonly recording: GhostRecording;
    readonly actions: GhostActions;
  }): void {
    // Un identifiant de siege est unique par match ; ceci ne se declenche donc
    // pas, mais un doublon laisserait des echeances orphelines.
    this.release(ghost.ghostPlayerId);
    this.ghosts.set(ghost.ghostPlayerId, {
      ...ghost,
      seq: 0,
      playedMoves: [],
      timerKeys: new Set(),
      timerCount: 0,
    });
  }

  /** Ce siege est-il tenu par un fantome que l'on pilote ? */
  isDriving(playerId: string): boolean {
    return this.ghosts.has(playerId);
  }

  /**
   * Recoit un message destine a un siege fantome.
   *
   * Le message est deja **valide** : il a traverse le schema sortant de
   * `@aura/protocol` avant d'arriver ici, comme celui qui part vers une socket.
   * Le fantome lit donc exactement ce qu'un client lirait, ni plus ni moins —
   * en particulier, il ne voit rien de son adversaire.
   */
  deliver(playerId: string, message: ParsedServerMessage): void {
    const live = this.ghosts.get(playerId);
    if (live === undefined) return;

    try {
      switch (message.name) {
        case 'recharge:start':
          this.planRecharge(live, message.data);
          break;
        case 'choice:start':
          this.planChoice(live, message.data);
          break;
        case 'match:end':
          this.release(playerId);
          break;
        default:
          // Tout le reste — l'intro, le resultat d'une manche, le fait que
          // l'adversaire ait verrouille — n'entre pas dans sa decision : un
          // fantome ne reagit pas a son adversaire (docs/05).
          break;
      }
    } catch (cause) {
      // Un rejeu qui trebuche ne doit pas emporter le match de son adversaire :
      // il jouera la manche par defaut, comme un joueur deconnecte.
      this.log?.warn(`rejeu de fantome impossible sur ${live.matchId} : ${describeCause(cause)}`);
    }
  }

  /** Oublie un fantome et desarme tout ce qu'il avait programme. */
  release(playerId: string): void {
    const live = this.ghosts.get(playerId);
    if (live === undefined) return;
    for (const key of live.timerKeys) this.scheduler.cancel(key);
    this.ghosts.delete(playerId);
  }

  /** Nombre de fantomes en cours de rejeu. Sert aux tests et au diagnostic. */
  get size(): number {
    return this.ghosts.size;
  }

  /**
   * Manche de l'enregistrement a rejouer.
   *
   * Un match enregistre a pu s'achever en deux manches la ou celui-ci va a la
   * belle : on rejoue alors la derniere manche connue plutot que de ne rien
   * jouer. Ne rien jouer serait une manche offerte, et c'est la manche
   * decisive.
   */
  private roundOf(live: LiveGhost, round: number): GhostRound | null {
    const rounds = live.recording.rounds;
    return rounds[round - 1] ?? rounds.at(-1) ?? null;
  }

  /** Les regles du match de ce fantome, lues a chaque decision. */
  private configFor(live: LiveGhost): BalanceConfig {
    return live.actions.configOf(live.matchId) ?? this.config;
  }

  /** Arme une echeance au nom de ce fantome, en gardant de quoi l'annuler. */
  private schedule(live: LiveGhost, atMs: number, run: () => void): void {
    live.timerCount += 1;
    const key = `${live.ghostPlayerId}:${String(live.timerCount)}`;
    live.timerKeys.add(key);
    this.scheduler.schedule(key, atMs, run);
  }

  /**
   * Programme la recharge du fantome.
   *
   * Le nombre de taps est la seule valeur de la recharge qui se rejoue telle
   * quelle : les points, eux, dependent des orbes de **cette** manche-ci, qui
   * ne sont pas celles de l'enregistrement. On reprend donc la cadence de l'IA
   * solo (`rechargeTapsForCount`), qui vise les orbes vivantes et reste sous le
   * plafond de douze taps par seconde.
   *
   * Les taps qui tomberaient apres la fin de la phase sont ecartes ici plutot
   * qu'envoyes : le moteur les refuserait, et le refus compterait au siege du
   * fantome comme un instant impossible — un signal d'anti-triche fabrique par
   * le serveur, sur un adversaire qui n'existe pas.
   */
  private planRecharge(live: LiveGhost, message: ServerMessage<'recharge:start'>): void {
    const round = this.roundOf(live, message.round);
    if (round === null) return;

    const orbs: readonly Orb[] = message.orbs.map((orb) => ({
      index: orb.index,
      x: orb.x,
      y: orb.y,
      kind: orb.kind,
      points: orb.points,
      lifetimeMs: orb.lifetimeMs,
    }));

    const phaseMs = message.endsAt - message.startsAt;
    const taps = rechargeTapsForCount(round.rechargeTaps, orbs, this.configFor(live)).filter(
      (tap) => tap.atMs <= phaseMs - GHOST_PHASE_GUARD_MS,
    );
    if (taps.length === 0) return;

    // Un lot par tranche de cadence, comme un client qui vide sa file toutes
    // les 500 ms. Une tranche sans tap n'envoie rien : un client non plus.
    const batches = new Map<number, RechargeTap[]>();
    for (const tap of taps) {
      const index = Math.floor(tap.atMs / GHOST_TAP_BATCH_MS);
      const batch = batches.get(index) ?? [];
      batch.push(tap);
      batches.set(index, batch);
    }

    for (const [index, batch] of batches) {
      const sendAtMs = Math.min(
        message.startsAt + (index + 1) * GHOST_TAP_BATCH_MS,
        message.endsAt - GHOST_PHASE_GUARD_MS,
      );
      // Meme borne qu'un message reel (`MAX_TAPS_PER_MESSAGE`) : un lot qu'un
      // client ne pourrait pas envoyer n'a rien a faire ici. La cadence de
      // `rechargeTapsForCount` n'en produit jamais autant — la borne est la
      // pour que cela reste vrai si elle change.
      const envoi = batch.slice(0, MAX_TAPS_PER_MESSAGE);
      this.schedule(live, sendAtMs, () => {
        live.seq += 1;
        if (!live.actions.acceptSeq(live.matchId, live.seat, live.seq)) return;
        live.actions.submitTaps(live.matchId, live.seat, envoi);
      });
    }
  }

  /**
   * Programme le verrouillage du fantome.
   *
   * Deux adaptations, et une seule est une decision de jeu :
   *
   * - **le timing** se refait sur la jauge de cette manche. L'enregistrement ne
   *   porte pas un instant — il ne voudrait rien dire sur une autre jauge —
   *   mais l'**ecart** obtenu, que `tapAtMsForDelta` reconvertit en instant
   *   ici. Le fantome rejoue donc son adresse, pas son geste ;
   * - **le choix** est joue tel quel s'il est payable. Sinon, et seulement
   *   sinon, il est rabattu par `affordableChoice`, c'est-a-dire par la
   *   politique de l'IA solo (docs/05 : « avec la meme politique que l'IA
   *   solo »). Le rabattre systematiquement effacerait les repetitions et les
   *   paliers que le joueur enregistre avait vraiment choisis.
   */
  private planChoice(live: LiveGhost, message: ServerMessage<'choice:start'>): void {
    const round = this.roundOf(live, message.round);
    if (round === null) return;

    const gauge: GaugeParams = {
      periodMs: message.meter.period,
      center: message.meter.center,
      zoneWidth: message.meter.zone,
      perfectWidth: message.meter.perfect,
    };

    /**
     * Instant de tap voulu, **dans les bornes d'un client reel**.
     *
     * Le protocole refuse un tap declare moins de `MIN_CHARGE_TO_TAP_MS` apres
     * le lancement de la charge — « en deca, c'est un robot ». Un fantome qui
     * declarerait un tel instant obtiendrait une jauge qu'aucun joueur ne peut
     * envoyer : un adversaire surhumain, par la seule porte que le rejeu
     * n'emprunte pas. On prefere alors ne pas taper du tout, ce qui ne peut
     * que lui nuire — l'ecart concerne de toute facon une jauge deja ratee.
     */
    const reproduit =
      round.timing.delta >= NO_TAP_DELTA
        ? null
        : tapAtMsForDelta(round.timing.delta, gauge, this.configFor(live));
    const wantedTapAtMs =
      reproduit !== null && reproduit >= MIN_CHARGE_TO_TAP_MS ? reproduit : null;

    const nowMs = this.clock.now();
    const latestLockAtMs = message.endsAt - GHOST_PHASE_GUARD_MS;
    const wantedLockAtMs = nowMs + (wantedTapAtMs ?? 0) + GHOST_LOCK_MARGIN_MS;

    /**
     * Une charge qu'on n'aura pas le temps de vivre ne se declare pas.
     *
     * Le serveur confronte l'instant declare a l'instant d'arrivee : annoncer
     * une charge plus longue que la phase serait refuse, et impute au siege.
     * Le fantome rate alors sa jauge — ce qui est exactement ce qui arriverait
     * a un joueur qui aurait charge trop longtemps.
     */
    const declarable = wantedTapAtMs !== null && wantedLockAtMs <= latestLockAtMs;
    const timingTapAtMs = declarable ? wantedTapAtMs : null;
    const lockAtMs = declarable ? wantedLockAtMs : Math.max(nowMs, latestLockAtMs);

    const desired: Choice = {
      move: round.move,
      amplifier: round.amplifier,
      useUltimate: round.useUltimate,
    };

    this.schedule(live, lockAtMs, () => {
      const choice = this.playableChoice(desired, message, live.playedMoves, this.configFor(live));
      live.playedMoves.push(choice.move);
      live.seq += 1;
      if (!live.actions.acceptSeq(live.matchId, live.seat, live.seq)) return;
      live.actions.lockChoice(live.matchId, live.seat, choice, timingTapAtMs);
    });
  }

  /**
   * Le choix enregistre, ou son equivalent payable.
   *
   * Les deux conditions sont celles que le moteur appliquera
   * (`NOT_ENOUGH_ENERGY`, `ULT_NOT_READY`) : on ne les reimplemente pas, on les
   * interroge — `isChoiceAffordable` vient de `@aura/rules`, et l'energie comme
   * la jauge sont celles que le serveur vient d'annoncer a ce siege.
   */
  private playableChoice(
    desired: Choice,
    message: ServerMessage<'choice:start'>,
    playedMoves: readonly Move[],
    config: BalanceConfig,
  ): Choice {
    const affordable = isChoiceAffordable(desired, message.energy, config);
    const ultimateReady = !desired.useUltimate || message.ult >= config.ultimate.gaugeMax;
    if (affordable && ultimateReady) return desired;

    return affordableChoice(
      desired,
      { energy: message.energy, ultimateGauge: message.ult, previousMoves: playedMoves },
      config,
    );
  }
}
