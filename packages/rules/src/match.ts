import { BALANCE, type BalanceConfig } from './balance.js';
import {
  evaluateRecharge,
  generateOrbSequence,
  type Orb,
  type RechargeResult,
  type RechargeTap,
} from './recharge.js';
import { createRng, deriveSeed } from './rng.js';
import {
  choiceCost,
  isChoiceAffordable,
  resolveRound,
  type RoundResult,
  type RoundSeatInput,
} from './round.js';
import { evaluateTiming, generateGaugeParams, type GaugeParams } from './timing.js';
import {
  opponentOf,
  type AmplifierLevel,
  type Choice,
  type Move,
  type Seat,
  type Style,
  type Tier,
} from './types.js';

/** Les cinq paliers, pour tirer une case brillante. */
const TIERS: readonly Tier[] = [0, 1, 2, 3, 4];

/**
 * Machine d'etat d'un match (docs/01-game-design.md §1, §8, §9 ; ADR 0005).
 *
 * `reduce` est une fonction pure : meme etat, meme evenement, meme resultat.
 * Elle ne connait ni le reseau, ni les minuteurs, ni la base de donnees. Le
 * serveur l'applique, puis execute les effets renvoyes : armer un minuteur sur
 * `endsAtMs`, envoyer les messages, persister. C'est ce decoupage qui permet de
 * rejouer un match entier en memoire pour arbitrer un litige.
 */

export type Phase = 'intro' | 'recharge' | 'choice' | 'reveal' | 'ended';

export type ChoiceRejection =
  'NOT_IN_CHOICE_PHASE' | 'ALREADY_LOCKED' | 'NOT_ENOUGH_ENERGY' | 'ULTIMATE_NOT_READY';

export interface SeatState {
  readonly energy: number;
  readonly ultimateGauge: number;
  readonly roundsWon: number;
  /** Somme des scores du match, pour le departage final. */
  readonly totalScore: number;
  /** Somme des ecarts de timing, dernier critere de departage. */
  readonly timingDeltaSum: number;
  /** Mouvements deja joues, pour detecter la repetition. */
  readonly moves: readonly Move[];
  /**
   * Amplificateurs deja joues, un par manche, dans l'ordre de `moves`.
   *
   * Le moteur retenait le mouvement et jetait l'amplificateur une fois la
   * manche resolue. En ligne cela ne se voyait pas — le serveur tient les
   * choix verrouilles et annonce lui-meme l'apparence — mais hors ligne
   * personne ne s'en souvenait, et le solo affichait toujours l'effet offert
   * du niveau zero, meme apres l'achat d'un skin.
   *
   * L'amplificateur decide de l'effet d'aura qu'on voit tourner autour d'un
   * combattant (docs/01 §3) : c'est une SORTIE du moteur au meme titre que le
   * mouvement, pas une entree qu'on peut oublier apres usage.
   *
   * Aligne sur `moves`, y compris pour une manche ou personne n'a verrouille :
   * le choix par defaut compte, sinon les deux tableaux se decalent des la
   * premiere fois que quelqu'un laisse filer le temps, et lire « le dernier
   * amplificateur » rendrait celui d'une autre manche.
   */
  readonly amplifiers: readonly AmplifierLevel[];
  /** Manches consecutives sans la moindre action. Deux d'affilee valent forfait. */
  readonly idleRounds: number;
}

export interface PendingSeat {
  readonly taps: readonly RechargeTap[];
  readonly boostPercent: number;
  /**
   * Evaluation complete de la recharge, disponible des la fin de la phase.
   *
   * Le serveur en a besoin pour annoncer les points et le combo dans
   * `round:result`. La garder ici evite qu'il refasse le calcul de son cote —
   * ce serait reimplementer une regle hors de ce package, avec le risque que
   * les deux versions finissent par diverger.
   */
  readonly recharge: RechargeResult | null;
  readonly locked: { readonly choice: Choice; readonly timingTapAtMs: number | null } | null;
  /** Le siege a-t-il agi durant cette manche ? */
  readonly acted: boolean;
}

export interface RoundContext {
  readonly orbs: readonly Orb[];
  readonly gauge: GaugeParams;
  /** Style joue d'office par qui ne verrouille pas a temps (§9). */
  readonly defaultStyle: Style;
  /**
   * La case brillante de chaque siege (docs/01). Secrete jusqu'a la
   * revelation : chaque siege n'apprend que la sienne.
   */
  readonly shiny: Readonly<Record<Seat, Move>>;
}

export interface MatchResult {
  readonly winner: Seat | null;
  readonly reason: 'rounds' | 'tiebreak' | 'forfeit';
  readonly roundsWon: Readonly<Record<Seat, number>>;
  readonly totalScore: Readonly<Record<Seat, number>>;
}

export interface MatchState {
  readonly seed: string;
  readonly phase: Phase;
  readonly round: number;
  readonly phaseEndsAtMs: number;
  readonly seats: Readonly<Record<Seat, SeatState>>;
  readonly pending: Readonly<Record<Seat, PendingSeat>>;
  readonly roundContext: RoundContext | null;
  readonly history: readonly RoundResult[];
  readonly result: MatchResult | null;
}

export type MatchEvent =
  | { readonly type: 'PHASE_TIMEOUT'; readonly atMs: number }
  | {
      readonly type: 'RECHARGE_TAPS';
      readonly seat: Seat;
      readonly taps: readonly RechargeTap[];
      readonly atMs: number;
    }
  | {
      readonly type: 'CHOICE_LOCKED';
      readonly seat: Seat;
      readonly choice: Choice;
      readonly timingTapAtMs: number | null;
      readonly atMs: number;
    }
  | { readonly type: 'PLAYER_FORFEIT'; readonly seat: Seat; readonly atMs: number };

export type MatchEffect =
  | {
      readonly type: 'PHASE_STARTED';
      readonly phase: Phase;
      readonly round: number;
      readonly endsAtMs: number;
    }
  | { readonly type: 'ROUND_RESOLVED'; readonly round: number; readonly result: RoundResult }
  | { readonly type: 'CHOICE_REJECTED'; readonly seat: Seat; readonly reason: ChoiceRejection }
  | { readonly type: 'MATCH_ENDED'; readonly result: MatchResult };

export interface MatchStep {
  readonly state: MatchState;
  readonly effects: readonly MatchEffect[];
}

const SEATS: readonly Seat[] = ['a', 'b'];

/**
 * Nombre maximal de taps conserves pour une manche, par siege.
 *
 * `maxTapsPerSecond x duree` est le maximum **physiquement** atteignable : le
 * plafond de cadence rejette tout ce qui va au-dela, donc les taps
 * supplementaires ne peuvent de toute facon rien rapporter.
 *
 * On plafonne au **stockage** et non a l'evaluation, et la difference n'est pas
 * cosmetique : le schema du protocole borne un message, pas la somme des
 * messages d'une phase. Sans cette borne, un client peut empiler des centaines
 * de milliers de taps en six secondes, que `evaluateRecharge` devra ensuite
 * trier — dans le callback d'une echeance, donc en bloquant tous les autres
 * matchs du processus. Un joueur honnete n'atteint jamais ce plafond.
 */
function maxStoredTaps(config: BalanceConfig): number {
  return (config.recharge.maxTapsPerSecond * config.recharge.durationMs) / 1_000;
}

const emptyPending = (): PendingSeat => ({
  taps: [],
  boostPercent: 0,
  recharge: null,
  locked: null,
  acted: false,
});

const initialSeat = (config: BalanceConfig): SeatState => ({
  energy: config.match.startingEnergy,
  ultimateGauge: 0,
  roundsWon: 0,
  totalScore: 0,
  timingDeltaSum: 0,
  moves: [],
  amplifiers: [],
  idleRounds: 0,
});

/** Une case tiree au sort, famille puis palier, dans un flux propre au siege. */
function drawShiny(seed: string, round: number, seat: Seat, config: BalanceConfig): Move {
  const rng = createRng(deriveSeed(seed, 'shiny', round, seat));
  return { style: rng.pick(config.styles), tier: rng.pick(TIERS) };
}

/** Prepare les tirages d'une manche. Chaque usage a son propre flux (voir deriveSeed). */
export function buildRoundContext(
  seed: string,
  round: number,
  config: BalanceConfig,
): RoundContext {
  return {
    shiny: { a: drawShiny(seed, round, 'a', config), b: drawShiny(seed, round, 'b', config) },
    orbs: generateOrbSequence(createRng(deriveSeed(seed, 'orbs', round)), config),
    gauge: generateGaugeParams(createRng(deriveSeed(seed, 'gauge', round)), config),
    defaultStyle: createRng(deriveSeed(seed, 'default', round)).pick(config.styles),
  };
}

export function createMatch(
  seed: string,
  options: { readonly startedAtMs?: number; readonly config?: BalanceConfig } = {},
): MatchStep {
  const config = options.config ?? BALANCE;
  const startedAtMs = options.startedAtMs ?? 0;
  const endsAtMs = startedAtMs + config.phases.introMs;

  return {
    state: {
      seed,
      phase: 'intro',
      round: 1,
      phaseEndsAtMs: endsAtMs,
      seats: { a: initialSeat(config), b: initialSeat(config) },
      pending: { a: emptyPending(), b: emptyPending() },
      roundContext: null,
      history: [],
      result: null,
    },
    effects: [{ type: 'PHASE_STARTED', phase: 'intro', round: 1, endsAtMs }],
  };
}

/** Termine le match et emet l'effet correspondant. */
function endMatch(
  state: MatchState,
  winner: Seat | null,
  reason: MatchResult['reason'],
): MatchStep {
  const result: MatchResult = {
    winner,
    reason,
    roundsWon: { a: state.seats.a.roundsWon, b: state.seats.b.roundsWon },
    totalScore: { a: state.seats.a.totalScore, b: state.seats.b.totalScore },
  };
  return {
    state: { ...state, phase: 'ended', result },
    effects: [{ type: 'MATCH_ENDED', result }],
  };
}

/** Ouvre une phase : pose l'echeance et annonce le debut. */
function enterPhase(state: MatchState, phase: Phase, atMs: number, durationMs: number): MatchStep {
  const endsAtMs = atMs + durationMs;
  return {
    state: { ...state, phase, phaseEndsAtMs: endsAtMs },
    effects: [{ type: 'PHASE_STARTED', phase, round: state.round, endsAtMs }],
  };
}

/** Departage de fin de match apres trois manches (§8). */
function tiebreak(state: MatchState): Seat | null {
  const { a, b } = state.seats;
  if (a.roundsWon !== b.roundsWon) return a.roundsWon > b.roundsWon ? 'a' : 'b';
  if (a.totalScore !== b.totalScore) return a.totalScore > b.totalScore ? 'a' : 'b';
  if (a.timingDeltaSum !== b.timingDeltaSum) return a.timingDeltaSum < b.timingDeltaSum ? 'a' : 'b';
  return null;
}

/** Applique le resultat d'une manche a l'etat des sieges. */
function applyRoundResult(
  state: MatchState,
  inputs: Readonly<Record<Seat, RoundSeatInput>>,
  result: RoundResult,
  config: BalanceConfig,
): MatchState {
  const updated = { ...state.seats };

  for (const seat of SEATS) {
    const before = state.seats[seat];
    const outcome = result.seats[seat];

    updated[seat] = {
      ...before,
      ultimateGauge: Math.min(
        before.ultimateGauge + outcome.ultimateGain,
        // Le plafond de la config du MATCH : une variante peut le changer.
        config.ultimate.gaugeMax,
      ),
      roundsWon: before.roundsWon + (result.winner === seat ? 1 : 0),
      totalScore: before.totalScore + outcome.score,
      timingDeltaSum: before.timingDeltaSum + inputs[seat].timing.delta,
      moves: [...before.moves, inputs[seat].choice.move],
      amplifiers: [...before.amplifiers, inputs[seat].choice.amplifier],
      idleRounds: state.pending[seat].acted ? 0 : before.idleRounds + 1,
    };
  }

  return { ...state, seats: updated, history: [...state.history, result] };
}

/** Resout la manche courante a partir des choix verrouilles (ou des choix par defaut). */
function resolveCurrentRound(state: MatchState, atMs: number, config: BalanceConfig): MatchStep {
  const context = state.roundContext;
  if (context === null) {
    return { state, effects: [] };
  }

  const inputFor = (seat: Seat): RoundSeatInput => {
    const locked = state.pending[seat].locked;
    // Sans verrouillage : palier 0 d'un style tire par la graine, A0, timing rate (§9).
    const choice: Choice = locked?.choice ?? {
      move: { style: context.defaultStyle, tier: 0 },
      amplifier: 0,
      useUltimate: false,
    };
    return {
      choice,
      timing: evaluateTiming(locked?.timingTapAtMs ?? null, context.gauge, config),
      boostPercent: state.pending[seat].boostPercent,
      previousMoves: state.seats[seat].moves,
      shiny: context.shiny[seat],
    };
  };

  const inputs = { a: inputFor('a'), b: inputFor('b') };
  const result = resolveRound(inputs, config);
  const applied = applyRoundResult(state, inputs, result, config);
  const entered = enterPhase(applied, 'reveal', atMs, config.phases.revealMs);

  return {
    state: entered.state,
    effects: [{ type: 'ROUND_RESOLVED', round: state.round, result }, ...entered.effects],
  };
}

/** Fin de la phase de revelation : manche suivante, ou fin de match. */
function afterReveal(state: MatchState, atMs: number, config: BalanceConfig): MatchStep {
  // L'inaction prolongee passe avant tout le reste : le match doit garder la
  // trace d'un abandon, qui ne se sanctionne pas comme une defaite ordinaire.
  const idleA = state.seats.a.idleRounds >= 2;
  const idleB = state.seats.b.idleRounds >= 2;
  if (idleA || idleB) {
    return endMatch(state, idleA && idleB ? null : idleA ? 'b' : 'a', 'forfeit');
  }

  for (const seat of SEATS) {
    if (state.seats[seat].roundsWon >= config.match.roundsToWin) {
      return endMatch(state, seat, 'rounds');
    }
  }

  if (state.round >= config.match.maxRounds) {
    return endMatch(state, tiebreak(state), 'tiebreak');
  }

  const next: MatchState = {
    ...state,
    round: state.round + 1,
    pending: { a: emptyPending(), b: emptyPending() },
    roundContext: null,
  };
  return enterPhase(next, 'intro', atMs, config.phases.introMs);
}

/** Fin de la recharge : on compte les points des deux sieges et on passe au choix. */
function afterRecharge(state: MatchState, atMs: number, config: BalanceConfig): MatchStep {
  const orbs = state.roundContext?.orbs ?? [];
  const seats = { ...state.seats };
  const pending = { ...state.pending };

  for (const seat of SEATS) {
    const evaluation = evaluateRecharge(state.pending[seat].taps, orbs, config);
    seats[seat] = {
      ...state.seats[seat],
      energy: Math.min(
        state.seats[seat].energy + evaluation.energyGain,
        config.match.startingEnergy,
      ),
      ultimateGauge: Math.min(
        state.seats[seat].ultimateGauge + evaluation.ultimateGain,
        config.ultimate.gaugeMax,
      ),
    };
    pending[seat] = {
      ...state.pending[seat],
      boostPercent: evaluation.boostPercent,
      recharge: evaluation,
    };
  }

  return enterPhase({ ...state, seats, pending }, 'choice', atMs, config.phases.choiceMs);
}

function handleTimeout(state: MatchState, atMs: number, config: BalanceConfig): MatchStep {
  switch (state.phase) {
    case 'intro':
      return enterPhase(
        { ...state, roundContext: buildRoundContext(state.seed, state.round, config) },
        'recharge',
        atMs,
        config.phases.rechargeMs,
      );
    case 'recharge':
      return afterRecharge(state, atMs, config);
    case 'choice':
      return resolveCurrentRound(state, atMs, config);
    case 'reveal':
      return afterReveal(state, atMs, config);
    case 'ended':
      return { state, effects: [] };
  }
}

function handleChoiceLocked(
  state: MatchState,
  event: Extract<MatchEvent, { type: 'CHOICE_LOCKED' }>,
  config: BalanceConfig,
): MatchStep {
  const reject = (reason: ChoiceRejection): MatchStep => ({
    state,
    effects: [{ type: 'CHOICE_REJECTED', seat: event.seat, reason }],
  });

  if (state.phase !== 'choice') return reject('NOT_IN_CHOICE_PHASE');
  if (state.pending[event.seat].locked !== null) return reject('ALREADY_LOCKED');

  const seatState = state.seats[event.seat];
  if (!isChoiceAffordable(event.choice, seatState.energy, config)) {
    return reject('NOT_ENOUGH_ENERGY');
  }
  if (event.choice.useUltimate && seatState.ultimateGauge < config.ultimate.gaugeMax) {
    return reject('ULTIMATE_NOT_READY');
  }

  const locked: MatchState = {
    ...state,
    seats: {
      ...state.seats,
      [event.seat]: {
        ...seatState,
        energy: seatState.energy - choiceCost(event.choice, config),
        // L'activation vide la jauge, que la manche soit gagnee ou non (§6).
        ultimateGauge: event.choice.useUltimate ? 0 : seatState.ultimateGauge,
      },
    },
    pending: {
      ...state.pending,
      [event.seat]: {
        ...state.pending[event.seat],
        locked: { choice: event.choice, timingTapAtMs: event.timingTapAtMs },
        acted: true,
      },
    },
  };

  const opponentLocked = locked.pending[opponentOf(event.seat)].locked !== null;
  // Les deux ont verrouille : inutile d'attendre l'echeance, on revele.
  return opponentLocked
    ? resolveCurrentRound(locked, event.atMs, config)
    : { state: locked, effects: [] };
}

export function reduce(
  state: MatchState,
  event: MatchEvent,
  config: BalanceConfig = BALANCE,
): MatchStep {
  if (state.phase === 'ended') {
    return { state, effects: [] };
  }

  switch (event.type) {
    case 'PHASE_TIMEOUT':
      // Une echeance qui n'est pas encore atteinte n'ouvre rien : le serveur est
      // seul maitre du temps, mais un minuteur en avance ne doit pas fausser la manche.
      return event.atMs < state.phaseEndsAtMs
        ? { state, effects: [] }
        : handleTimeout(state, event.atMs, config);

    case 'RECHARGE_TAPS': {
      if (state.phase !== 'recharge') return { state, effects: [] };

      const kept = [...state.pending[event.seat].taps, ...event.taps].slice(
        0,
        maxStoredTaps(config),
      );

      return {
        state: {
          ...state,
          pending: {
            ...state.pending,
            [event.seat]: {
              ...state.pending[event.seat],
              taps: kept,
              acted: state.pending[event.seat].acted || event.taps.length > 0,
            },
          },
        },
        effects: [],
      };
    }

    case 'CHOICE_LOCKED':
      return handleChoiceLocked(state, event, config);

    case 'PLAYER_FORFEIT':
      return endMatch(state, opponentOf(event.seat), 'forfeit');
  }
}
