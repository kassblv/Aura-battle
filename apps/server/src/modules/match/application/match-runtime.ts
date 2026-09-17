import { defaultAnimationFor, defaultEffectForLevel } from '@aura/content';
import type { ErrorCode, ServerMessage } from '@aura/protocol';
import {
  BALANCE,
  createMatch,
  opponentOf,
  reduce,
  RULES_VERSION,
  type BalanceConfig,
  type Choice,
  type ChoiceRejection,
  type MatchEffect,
  type MatchEvent,
  type MatchState,
  type RechargeTap,
  type RoundResult,
  type Seat,
} from '@aura/rules';
import { CONTENT_VERSION } from '@aura/content';
import type {
  MatchClock,
  MatchNotifier,
  MatchRecord,
  MatchRepository,
  TimerScheduler,
} from '../domain/ports.js';
import { choiceStartFor, matchStateFor, rechargeStartFor, roundIntroFor } from './views.js';

/**
 * Deroulement des matchs en cours (docs/02, docs/03 ; jalon M3).
 *
 * Le runtime ne decide rien : il applique `reduce` de `@aura/rules` et execute
 * les effets renvoyes — armer une echeance, envoyer un message, terminer.
 * Aucune regle de jeu n'est reecrite ici (regle d'or n°1).
 *
 * Tout message part par une des fonctions de vue, jamais construit sur place :
 * c'est ce qui tient la regle d'or n°4.
 */

export interface MatchSeats {
  readonly a: string;
  readonly b: string;
}

/** Cosmetique choisi pour une manche. Le gameplay l'ignore totalement. */
interface Cosmetic {
  readonly animationId: string;
  readonly effectId: string;
}

interface LiveMatch {
  readonly matchId: string;
  readonly seed: string;
  readonly seats: MatchSeats;
  readonly startedAtMs: number;
  state: MatchState;
  /** Cosmetiques de la manche en cours, par siege. */
  cosmetics: Record<Seat, Cosmetic | null>;
  /**
   * Dernier `seq` traite par siege.
   *
   * Le protocole impose un compteur croissant par client (docs/03). Sans lui,
   * un client qui se reconnecte et renvoie ses taps par securite les fait
   * compter deux fois — un champ valide mais jamais lu donne l'illusion d'une
   * protection.
   */
  lastSeq: Record<Seat, number>;
  /**
   * Journal des evenements appliques.
   *
   * Graine + journal = le match rejouable a l'identique. C'est la seule facon
   * de trancher un litige sur un resultat autrement que sur parole.
   */
  readonly journal: { atMs: number; event: MatchEvent }[];
}

const SEATS: readonly Seat[] = ['a', 'b'];

/**
 * Delai avant qu'une deconnexion devienne definitive (docs/03).
 *
 * Quarante-cinq secondes : assez pour un tunnel, un changement de reseau ou
 * une mise en arriere-plan, trop peu pour attendre indefiniment quelqu'un qui
 * est parti. Entre les deux, le match continue sans lui et les actions par
 * defaut s'appliquent — il n'est pas puni, il joue mal.
 */
const DISCONNECT_GRACE_MS = 45_000;

/** Cle du minuteur de deconnexion d'un siege. */
const disconnectKey = (matchId: string, seat: Seat): string => `${matchId}:disconnect:${seat}`;

/**
 * Correspondance entre les refus du moteur et les codes du protocole.
 *
 * Les deux vocabulaires sont volontairement distincts : le moteur parle de
 * regles de jeu, le protocole parle au client. Les relier ici, explicitement,
 * evite qu'un refus interne se retrouve tel quel sur le reseau.
 */
const REJECTION_CODES: Readonly<Record<ChoiceRejection, ErrorCode>> = {
  NOT_IN_CHOICE_PHASE: 'WRONG_PHASE',
  ALREADY_LOCKED: 'ALREADY_LOCKED',
  NOT_ENOUGH_ENERGY: 'NOT_ENOUGH_ENERGY',
  ULTIMATE_NOT_READY: 'ULT_NOT_READY',
};

export class MatchRuntime {
  private readonly matches = new Map<string, LiveMatch>();

  constructor(
    private readonly notifier: MatchNotifier,
    private readonly scheduler: TimerScheduler,
    private readonly clock: MatchClock,
    /**
     * Valeurs de jeu. Injectable a dessein : les tests de bout en bout
     * raccourcissent les phases pour jouer un match entier en une seconde, et
     * les evenements de live-ops (docs/07) feront varier les regles en donnee.
     */
    private readonly config: BalanceConfig = BALANCE,
    /** Ecriture du match acheve. Absente, les matchs ne sont pas conserves. */
    private readonly repository: MatchRepository | null = null,
  ) {}

  /**
   * Signale la deconnexion d'un joueur.
   *
   * Le match **continue** : couper tout de suite punirait quelqu'un qui passe
   * sous un tunnel. On arme seulement le compte a rebours au bout duquel la
   * deconnexion devient un abandon.
   */
  notePlayerDisconnected(playerId: string): void {
    const found = this.locate(playerId);
    if (found === null) return;

    const { match, seat } = found;
    this.scheduler.schedule(
      disconnectKey(match.matchId, seat),
      this.clock.now() + DISCONNECT_GRACE_MS,
      () => {
        // Le match peut s'etre termine entre-temps ; `forfeit` l'ignore alors.
        this.forfeit(match.matchId, seat);
      },
    );
  }

  /** Le joueur est revenu : on desarme le compte a rebours. */
  notePlayerReconnected(playerId: string): void {
    const found = this.locate(playerId);
    if (found === null) return;
    this.scheduler.cancel(disconnectKey(found.match.matchId, found.seat));
  }

  /**
   * Accepte un numero d'action, ou le rejette comme deja traite.
   *
   * Idempotence : rejouer une action deja prise en compte ne doit rien
   * changer. On compare au dernier numero vu plutot que de tenir la liste de
   * tous les numeros — le protocole garantit qu'ils croissent.
   */
  acceptSeq(matchId: string, seat: Seat, seq: number): boolean {
    const match = this.matches.get(matchId);
    if (match === undefined) return false;
    if (seq <= match.lastSeq[seat]) return false;
    match.lastSeq[seat] = seq;
    return true;
  }

  /** Retrouve le match et le siege d'un joueur, s'il en a un. */
  private locate(playerId: string): { match: LiveMatch; seat: Seat } | null {
    for (const match of this.matches.values()) {
      const seat = SEATS.find((candidate) => match.seats[candidate] === playerId);
      if (seat !== undefined) return { match, seat };
    }
    return null;
  }

  /** Phase d'un match en cours, ou `null` s'il n'existe pas (ou plus). */
  phaseOf(matchId: string): MatchState['phase'] | null {
    return this.matches.get(matchId)?.state.phase ?? null;
  }

  /** Siege occupe par un joueur dans ce match. */
  seatOf(matchId: string, playerId: string): Seat | null {
    const match = this.matches.get(matchId);
    if (match === undefined) return null;
    return SEATS.find((seat) => match.seats[seat] === playerId) ?? null;
  }

  createMatch(input: { matchId: string; seed: string; seats: MatchSeats }): void {
    const step = createMatch(input.seed, {
      startedAtMs: this.clock.now(),
      config: this.config,
    });
    const match: LiveMatch = {
      matchId: input.matchId,
      seed: input.seed,
      seats: input.seats,
      startedAtMs: this.clock.now(),
      state: step.state,
      cosmetics: { a: null, b: null },
      lastSeq: { a: 0, b: 0 },
      journal: [],
    };
    this.matches.set(input.matchId, match);
    this.runEffects(match, step.effects);
  }

  /** Instantane de reprise pour un siege, sans information cachee. */
  snapshotFor(matchId: string, seat: Seat): ServerMessage<'match:state'> | null {
    const match = this.matches.get(matchId);
    return match === undefined ? null : matchStateFor(seat, match.state, matchId);
  }

  submitTaps(matchId: string, seat: Seat, taps: readonly RechargeTap[]): void {
    const match = this.matches.get(matchId);
    if (match === undefined) return;
    this.apply(match, { type: 'RECHARGE_TAPS', seat, taps, atMs: this.clock.now() });
  }

  lockChoice(
    matchId: string,
    seat: Seat,
    choice: Choice,
    timingTapAtMs: number | null,
    cosmetic?: Cosmetic,
  ): void {
    const match = this.matches.get(matchId);
    if (match === undefined) return;

    if (cosmetic !== undefined) {
      match.cosmetics[seat] = cosmetic;
    }

    const before = match.state.pending[seat].locked;
    this.apply(match, {
      type: 'CHOICE_LOCKED',
      seat,
      choice,
      timingTapAtMs,
      atMs: this.clock.now(),
    });

    // Le verrouillage a-t-il ete accepte ? Si oui, l'adversaire apprend ce
    // seul fait — ni le mouvement, ni le timing, ni le cout.
    const after = this.matches.get(matchId)?.state.pending[seat].locked;
    if (before === null && after !== null && after !== undefined) {
      const opponent = opponentOf(seat);
      this.notifier.send(match.seats[opponent], 'opponent:locked', {
        matchId,
        round: match.state.round,
      });
    }
  }

  forfeit(matchId: string, seat: Seat): void {
    const match = this.matches.get(matchId);
    if (match === undefined) return;
    this.apply(match, { type: 'PLAYER_FORFEIT', seat, atMs: this.clock.now() });
  }

  /** Echeance de phase : c'est le serveur qui decide quand elle tombe. */
  private handleTimeout(matchId: string): void {
    const match = this.matches.get(matchId);
    if (match === undefined) return;
    this.apply(match, { type: 'PHASE_TIMEOUT', atMs: match.state.phaseEndsAtMs });
  }

  private apply(match: LiveMatch, event: MatchEvent): void {
    match.journal.push({ atMs: this.clock.now(), event });
    const step = reduce(match.state, event, this.config);
    match.state = step.state;
    this.runEffects(match, step.effects);
  }

  private runEffects(match: LiveMatch, effects: readonly MatchEffect[]): void {
    for (const effect of effects) {
      switch (effect.type) {
        case 'PHASE_STARTED':
          this.announcePhase(match, effect.phase, effect.endsAtMs);
          break;
        case 'ROUND_RESOLVED':
          this.announceResult(match, effect.result);
          break;
        case 'CHOICE_REJECTED':
          this.notifier.send(match.seats[effect.seat], 'error', {
            code: REJECTION_CODES[effect.reason],
            message: 'choix refuse',
            // Un choix deja verrouille ne se rejoue pas ; les autres refus
            // laissent au joueur la possibilite d'en proposer un autre.
            retryable: effect.reason !== 'ALREADY_LOCKED',
          });
          break;
        case 'MATCH_ENDED':
          this.announceEnd(match, effect.result);
          break;
      }
    }
  }

  private announcePhase(match: LiveMatch, phase: MatchState['phase'], endsAtMs: number): void {
    // L'echeance est armee avant l'envoi : si le client ne repond jamais, la
    // phase se ferme quand meme.
    this.scheduler.schedule(match.matchId, endsAtMs, () => {
      this.handleTimeout(match.matchId);
    });

    for (const seat of SEATS) {
      const player = match.seats[seat];
      switch (phase) {
        case 'intro':
          this.notifier.send(
            player,
            'round:intro',
            roundIntroFor(seat, match.state, match.matchId),
          );
          break;
        case 'recharge':
          this.notifier.send(
            player,
            'recharge:start',
            rechargeStartFor(match.state, match.matchId),
          );
          break;
        case 'choice':
          this.notifier.send(
            player,
            'choice:start',
            choiceStartFor(seat, match.state, match.matchId),
          );
          break;
        case 'reveal':
        case 'ended':
          break;
      }
    }
  }

  /** Cosmetique effectif d'un siege : celui equipe, sinon celui offert a tous. */
  private cosmeticOf(match: LiveMatch, seat: Seat, result: RoundResult): Cosmetic {
    const chosen = match.cosmetics[seat];
    if (chosen !== null) return chosen;

    const locked = match.state.pending[seat].locked;
    const move = locked?.choice.move ?? { style: 'calme' as const, tier: 0 as const };
    const amplifier = locked?.choice.amplifier ?? 0;
    void result;
    return {
      animationId: defaultAnimationFor(move),
      effectId: defaultEffectForLevel(amplifier).id,
    };
  }

  private announceResult(match: LiveMatch, result: RoundResult): void {
    const sideFor = (seat: Seat): ServerMessage<'round:result'>['sides']['a'] => {
      const outcome = result.seats[seat];
      const locked = match.state.pending[seat].locked;
      const recharge = match.state.pending[seat].recharge;
      const move = locked?.choice.move ?? { style: 'calme' as const, tier: 0 as const };

      return {
        move,
        amp: locked?.choice.amplifier ?? 0,
        ult: locked?.choice.useUltimate ?? false,
        cosmetic: this.cosmeticOf(match, seat, result),
        recharge: {
          points: recharge?.points ?? 0,
          bestCombo: recharge?.bestCombo ?? 0,
          boostPct: match.state.pending[seat].boostPercent,
          ultGain: recharge?.ultimateGain ?? 0,
          energyGain: recharge?.energyGain ?? 0,
        },
        // Repris de la resolution, jamais recalcule ici.
        timing: { quality: outcome.timing.quality, error: outcome.timing.delta },
        repeat: outcome.repeated,
        counter: outcome.countered,
        countered: outcome.wasCountered,
        counterBlocked: outcome.counterBlocked,
        base: outcome.base,
        final: outcome.score,
        energyAfter: match.state.seats[seat].energy,
        ultAfter: match.state.seats[seat].ultimateGauge,
      };
    };

    const payload: ServerMessage<'round:result'> = {
      matchId: match.matchId,
      // `state.round` a deja avance si la manche s'est enchainee : on lit le
      // rang de la manche dans l'historique, qui ne bouge plus.
      round: match.state.history.length,
      sides: { a: sideFor('a'), b: sideFor('b') },
      winner: result.winner,
      roundsWon: { a: match.state.seats.a.roundsWon, b: match.state.seats.b.roundsWon },
      // On revele le perdant en premier : le vainqueur ferme la scene.
      timeline: { revealFirst: result.winner === 'a' ? 'b' : 'a' },
    };

    for (const seat of SEATS) {
      this.notifier.send(match.seats[seat], 'round:result', payload);
    }

    // La manche est jouee : les cosmetiques de la suivante seront redemandes.
    match.cosmetics = { a: null, b: null };
  }

  private announceEnd(match: LiveMatch, result: { winner: Seat | null; reason: string }): void {
    const payload: ServerMessage<'match:end'> = {
      matchId: match.matchId,
      winner: result.winner,
      reason: result.reason as ServerMessage<'match:end'>['reason'],
      // Classement et recompenses arrivent au jalon M5.
      rating: { before: 1_000, after: 1_000, leagueBefore: 'bronze', leagueAfter: 'bronze' },
      rewards: { softCurrency: 0, xp: 0 },
    };

    for (const seat of SEATS) {
      this.notifier.send(match.seats[seat], 'match:end', payload);
    }

    this.persist(match, result);

    // Un match termine ne doit plus rien retenir : ni minuteur, ni memoire.
    this.scheduler.cancel(match.matchId);
    for (const seat of SEATS) {
      this.scheduler.cancel(disconnectKey(match.matchId, seat));
    }
    this.matches.delete(match.matchId);
  }

  /**
   * Ecrit le match acheve.
   *
   * L'ecriture ne bloque pas la fin de partie : les joueurs ont deja recu leur
   * resultat, et une base lente ne doit pas retarder leur ecran de victoire.
   * Un echec est journalise par l'adaptateur, jamais propage ici — perdre un
   * enregistrement est regrettable, faire tomber le serveur l'est davantage.
   */
  private persist(match: LiveMatch, result: { winner: Seat | null; reason: string }): void {
    if (this.repository === null) return;

    const record: MatchRecord = {
      matchId: match.matchId,
      seed: match.seed,
      mode: 'INVITE',
      rulesVersion: RULES_VERSION,
      contentVersion: CONTENT_VERSION,
      seats: { a: match.seats.a, b: match.seats.b },
      winner: result.winner,
      reason: result.reason,
      startedAtMs: match.startedAtMs,
      endedAtMs: this.clock.now(),
      rounds: match.state.history.map((round, index) => ({ round: index + 1, result: round })),
      events: match.journal.map((entry) => ({ atMs: entry.atMs, event: entry.event })),
    };

    void this.repository.save(record).catch(() => {
      // L'adaptateur journalise le detail.
    });
  }
}
