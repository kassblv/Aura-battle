import { BALANCE, type BalanceConfig } from './balance.js';
import { beats } from './counters.js';
import type { TimingResult } from './timing.js';
import type { Choice, Move, Seat, Style } from './types.js';

/**
 * Resolution d'une manche (docs/01-game-design.md §7).
 *
 * Aucun aleatoire ici : a choix identiques et timings identiques, le resultat
 * est toujours le meme. Le hasard du jeu se limite a la generation des orbes et
 * de la jauge, qui sont communes aux deux joueurs.
 */

export interface RoundSeatInput {
  readonly choice: Choice;
  readonly timing: TimingResult;
  /** Boost gagne a la recharge, en pourcentage (0 a 25). */
  readonly boostPercent: number;
  /** Mouvements deja joues par ce siege dans le match, pour detecter la repetition. */
  readonly previousMoves: readonly Move[];
  /** La case brillante de ce siege pour la manche, ou `null` (docs/01). */
  readonly shiny: Move | null;
  /** La famille annoncee par la bulle d'intention, ou `null` (docs/01 §10). */
  readonly intent?: Style | null;
}

export interface RoundSeatOutcome {
  /** Score final, contres compris. C'est lui qui designe le vainqueur. */
  readonly score: number;
  /**
   * Score avant application des contres.
   *
   * Le client s'en sert pour mettre en scene la revelation : on montre d'abord
   * ce que valait l'aura, puis l'effet du contre. Le calculer ici evite au
   * serveur de refaire le produit de son cote.
   */
  readonly base: number;
  /** Qualite et ecart du timing, repris tels quels pour `round:result`. */
  readonly timing: TimingResult;
  readonly repeated: boolean;
  /** A contre l'adversaire et touche le bonus. */
  readonly countered: boolean;
  /** A subi le contre adverse. */
  readonly wasCountered: boolean;
  /** Avait le style gagnant, mais l'Ultime adverse a annule son contre. */
  readonly counterBlocked: boolean;
  /** Le siege a joue sa case brillante : son score a ete multiplie. */
  readonly shiny: boolean;
  /**
   * A depense son Ultime dans cette manche.
   *
   * Le multiplicateur le dit deja, mais seulement a qui refait le calcul. La
   * mise en scene a besoin du fait lui-meme : le deduire d'un produit de six
   * facteurs reviendrait a redecouvrir une regle depuis son effet.
   */
  readonly usedUltimate: boolean;
  readonly energySpent: number;
  /**
   * A gagne la manche avec la famille annoncee par sa bulle (docs/01 §10) :
   * le bonus est compris dans `ultimateGain`. La mise en scene en a besoin.
   */
  readonly intentKept: boolean;
  /** Jauge d'Ultime gagnee a l'issue de la manche. */
  readonly ultimateGain: number;
}

export interface RoundResult {
  /** Vainqueur de la manche, ou `null` si elle est nulle. */
  readonly winner: Seat | null;
  readonly seats: Readonly<Record<Seat, RoundSeatOutcome>>;
}

/**
 * Precision a laquelle on rabat le produit avant d'arrondir.
 *
 * Le score est un produit de six facteurs flottants : `30 x 1,50 x 0,70` donne
 * `31,499999999999996`, qui s'arrondit a 31 au lieu de 32. Un point entier de
 * score se perd sur une erreur de 3,5e-15, et ce point peut decider de la
 * manche. On rabat donc sur 1e-9 : largement au-dessus du bruit accumule,
 * largement en dessous de toute difference de score qui a un sens.
 */
const SCORE_PRECISION = 1e9;

/** Arrondit un score au plus proche entier, a l'abri du bruit flottant. */
function roundScore(value: number): number {
  return Math.round(Math.round(value * SCORE_PRECISION) / SCORE_PRECISION);
}

/** Cout en energie d'un choix. L'Ultime se paie en jauge, pas en energie. */
export function choiceCost(choice: Choice, config: BalanceConfig = BALANCE): number {
  return config.tierCost[choice.move.tier] + config.amplifierCost[choice.amplifier];
}

/** Un choix est jouable si l'energie restante en couvre le cout. */
export function isChoiceAffordable(
  choice: Choice,
  energy: number,
  config: BalanceConfig = BALANCE,
): boolean {
  return choiceCost(choice, config) <= energy;
}

/** Vrai si ce mouvement exact (style et palier) a deja ete joue dans le match. */
function isRepeat(move: Move, previousMoves: readonly Move[]): boolean {
  return previousMoves.some((played) => played.style === move.style && played.tier === move.tier);
}

export function resolveRound(
  inputs: Readonly<Record<Seat, RoundSeatInput>>,
  config: BalanceConfig = BALANCE,
): RoundResult {
  const { a, b } = inputs;

  const aBeatsB = beats(a.choice.move.style, b.choice.move.style, config);
  const bBeatsA = beats(b.choice.move.style, a.choice.move.style, config);

  // L'Ultime rend son porteur impossible a contrer : le contre adverse est
  // annule, et celui qui le perd ne subit pas de malus pour autant (§6).
  const aCounters = aBeatsB && !b.choice.useUltimate;
  const bCounters = bBeatsA && !a.choice.useUltimate;

  const outcomeFor = (
    seat: RoundSeatInput,
    counters: boolean,
    isCountered: boolean,
    counterBlocked: boolean,
  ): Omit<RoundSeatOutcome, 'ultimateGain' | 'intentKept'> => {
    const repeated = isRepeat(seat.choice.move, seat.previousMoves);
    const shiny =
      seat.shiny !== null &&
      seat.shiny.style === seat.choice.move.style &&
      seat.shiny.tier === seat.choice.move.tier;
    const base =
      config.tierPower[seat.choice.move.tier] *
      config.amplifierMultiplier[seat.choice.amplifier] *
      seat.timing.multiplier *
      (repeated ? config.repeatMultiplier : 1) *
      (seat.choice.useUltimate ? config.ultimate.multiplier : 1) *
      (shiny ? config.shiny.multiplier : 1) *
      (1 + seat.boostPercent / 100);
    const final =
      base *
      (counters ? config.counter.winnerMultiplier : 1) *
      (isCountered ? config.counter.loserMultiplier : 1);

    return {
      score: roundScore(final),
      base: roundScore(base),
      timing: seat.timing,
      repeated,
      countered: counters,
      wasCountered: isCountered,
      counterBlocked,
      usedUltimate: seat.choice.useUltimate,
      shiny,
      energySpent: choiceCost(seat.choice, config),
    };
  };

  const aOutcome = outcomeFor(a, aCounters, bCounters, aBeatsB && b.choice.useUltimate);
  const bOutcome = outcomeFor(b, bCounters, aCounters, bBeatsA && a.choice.useUltimate);

  const winner: Seat | null =
    aOutcome.score !== bOutcome.score
      ? aOutcome.score > bOutcome.score
        ? 'a'
        : 'b'
      : a.timing.delta !== b.timing.delta
        ? a.timing.delta < b.timing.delta
          ? 'a'
          : 'b'
        : null;

  /** La bulle tenue : gagner avec la famille qu'on a annoncee (§10). */
  const intentKeptFor = (seat: RoundSeatInput, thisSeat: Seat): boolean =>
    config.intent.enabled &&
    winner === thisSeat &&
    seat.intent !== undefined &&
    seat.intent !== null &&
    seat.intent === seat.choice.move.style;

  /** Gains de jauge : parfait, contre reussi, manche perdue (§6), bulle tenue (§10). Ils se cumulent. */
  const ultimateGainFor = (
    seat: RoundSeatInput,
    outcome: Omit<RoundSeatOutcome, 'ultimateGain' | 'intentKept'>,
    thisSeat: Seat,
    intentKept: boolean,
  ): number => {
    let gain = 0;
    if (seat.timing.quality === 'perfect') gain += config.ultimate.gainOnPerfect;
    if (outcome.countered) gain += config.ultimate.gainOnCounter;
    if (winner !== null && winner !== thisSeat) gain += config.ultimate.gainOnRoundLost;
    if (intentKept) gain += config.intent.ultimateBonus;
    return Math.min(gain, config.ultimate.gaugeMax);
  };

  const aKept = intentKeptFor(a, 'a');
  const bKept = intentKeptFor(b, 'b');
  return {
    winner,
    seats: {
      a: { ...aOutcome, intentKept: aKept, ultimateGain: ultimateGainFor(a, aOutcome, 'a', aKept) },
      b: { ...bOutcome, intentKept: bKept, ultimateGain: ultimateGainFor(b, bOutcome, 'b', bKept) },
    },
  };
}
