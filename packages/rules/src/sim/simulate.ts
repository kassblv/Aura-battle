import { rechargeTapsForCount, timingTapForSkill, type TimingSkill } from '../ai/profiles.js';
import { BALANCE, type BalanceConfig } from '../balance.js';
import { createMatch, reduce, type MatchResult, type MatchState } from '../match.js';
import { createRng, deriveSeed, type Rng } from '../rng.js';
import type { RoundResult } from '../round.js';
import type { Move, Seat, Style, Tier } from '../types.js';
import { STRATEGIES, STRATEGY_IDS, type ChoicePolicy, type StrategyId } from './strategies.js';

/**
 * Simulateur d'equilibrage (docs/09-testing.md).
 *
 * Il fait jouer des strategies les unes contre les autres et mesure ce que le
 * document de test demande de surveiller. Tout est seede : un rapport se
 * reproduit a l'identique, ce qui permet de comparer un avant et un apres
 * changement de `balance.ts` sans que le bruit aleatoire brouille la lecture.
 */

const SEATS: readonly Seat[] = ['a', 'b'];

/** Adresse au timing par defaut : un joueur correct, ni expert ni debutant. */
const DEFAULT_SKILL: TimingSkill = { perfect: 0.3, good: 0.5 };

export interface MatchSimulation {
  readonly result: MatchResult;
  readonly rounds: readonly RoundResult[];
  readonly finalEnergy: Readonly<Record<Seat, number>>;
  readonly moves: Readonly<Record<Seat, readonly Move[]>>;
}

export interface SimulateOptions {
  readonly config?: BalanceConfig;
  readonly skill?: Readonly<Record<Seat, TimingSkill>>;
  /** Fourchette du nombre de taps a la recharge, commune aux deux sieges. */
  readonly rechargeTaps?: readonly [number, number];
}

/** Garde-fou : un match sain ne demande qu'une quinzaine de transitions. */
const MAX_TRANSITIONS = 200;

export function simulateMatch(
  seed: string,
  strategies: Readonly<Record<Seat, ChoicePolicy>>,
  options: SimulateOptions = {},
): MatchSimulation {
  const config = options.config ?? BALANCE;
  const skill = options.skill ?? { a: DEFAULT_SKILL, b: DEFAULT_SKILL };
  const [minTaps, maxTaps] = options.rechargeTaps ?? [10, 18];

  const rng: Record<Seat, Rng> = {
    a: createRng(deriveSeed(seed, 'sim', 'a')),
    b: createRng(deriveSeed(seed, 'sim', 'b')),
  };

  let step = createMatch(seed, { config });
  let transitions = 0;

  while (step.state.phase !== 'ended' && transitions < MAX_TRANSITIONS) {
    transitions += 1;
    const state: MatchState = step.state;

    switch (state.phase) {
      case 'intro':
      case 'reveal':
        step = reduce(state, { type: 'PHASE_TIMEOUT', atMs: state.phaseEndsAtMs }, config);
        break;

      case 'recharge': {
        const orbs = state.roundContext?.orbs ?? [];
        for (const seat of SEATS) {
          const taps = rechargeTapsForCount(rng[seat].nextInt(minTaps, maxTaps), orbs, config);
          step = reduce(step.state, { type: 'RECHARGE_TAPS', seat, taps, atMs: 0 }, config);
        }
        step = reduce(
          step.state,
          { type: 'PHASE_TIMEOUT', atMs: step.state.phaseEndsAtMs },
          config,
        );
        break;
      }

      case 'choice': {
        const gauge = state.roundContext?.gauge;
        if (gauge === undefined) {
          step = reduce(state, { type: 'PHASE_TIMEOUT', atMs: state.phaseEndsAtMs }, config);
          break;
        }
        for (const seat of SEATS) {
          const current = step.state;
          if (current.phase !== 'choice') break;
          const opponent: Seat = seat === 'a' ? 'b' : 'a';
          const choice = strategies[seat].decideChoice(
            {
              rng: rng[seat],
              energy: current.seats[seat].energy,
              ultimateGauge: current.seats[seat].ultimateGauge,
              previousMoves: current.seats[seat].moves,
              opponentStyles: current.seats[opponent].moves.map((move) => move.style),
              round: current.round,
              roundsWon: current.seats[seat].roundsWon,
              opponentRoundsWon: current.seats[opponent].roundsWon,
            },
            config,
          );
          step = reduce(
            current,
            {
              type: 'CHOICE_LOCKED',
              seat,
              choice,
              timingTapAtMs: timingTapForSkill(skill[seat], gauge, rng[seat], config),
              atMs: current.phaseEndsAtMs - 1_000,
            },
            config,
          );
          // Un choix refuse laisserait le siege bloque : on retombe sur le
          // mouvement gratuit plutot que de tourner en rond.
          if (step.effects.some((effect) => effect.type === 'CHOICE_REJECTED')) {
            step = reduce(
              step.state,
              {
                type: 'CHOICE_LOCKED',
                seat,
                choice: {
                  move: { style: choice.move.style, tier: 0 },
                  amplifier: 0,
                  useUltimate: false,
                },
                timingTapAtMs: timingTapForSkill(skill[seat], gauge, rng[seat], config),
                atMs: current.phaseEndsAtMs - 1_000,
              },
              config,
            );
          }
        }
        break;
      }

      case 'ended':
        break;
    }
  }

  const final = step.state;
  if (final.result === null) {
    throw new Error(`Le match ${seed} ne s'est pas termine en ${MAX_TRANSITIONS} transitions`);
  }

  return {
    result: final.result,
    rounds: final.history,
    finalEnergy: { a: final.seats.a.energy, b: final.seats.b.energy },
    moves: { a: final.seats.a.moves, b: final.seats.b.moves },
  };
}

export interface TournamentOptions {
  readonly matches: number;
  readonly seed: string;
  readonly config?: BalanceConfig;
}

export interface TournamentReport {
  readonly matches: number;
  readonly winRateByStrategy: Readonly<Record<StrategyId, number>>;
  readonly winRateByPair: Readonly<Record<string, number>>;
  readonly winRateByStyle: Readonly<Record<Style, number>>;
  readonly winRateByTier: Readonly<Record<Tier, number>>;
  readonly finishes: {
    readonly twoNil: number;
    readonly twoOne: number;
    readonly tiebreak: number;
  };
  readonly drawRoundRate: number;
  /** Taux de victoire d'un joueur a 60 % de parfaits face a un joueur a 20 %. */
  readonly timingAdvantage: number;
  /** Score moyen obtenu par point d'energie depense, manche par manche. */
  readonly energyValueByRound: Readonly<Record<number, number>>;
}

/** Compteur « parties jouees / points gagnes », ou un nul vaut une demi-victoire. */
interface Tally {
  games: number;
  points: number;
}

const newTally = (): Tally => ({ games: 0, points: 0 });
const rate = (tally: Tally): number => (tally.games === 0 ? 0 : tally.points / tally.games);

export function runTournament(options: TournamentOptions): TournamentReport {
  const config = options.config ?? BALANCE;

  const pairs = STRATEGY_IDS.flatMap((left) => STRATEGY_IDS.map((right) => [left, right] as const));

  const byStrategy = new Map<StrategyId, Tally>(STRATEGY_IDS.map((id) => [id, newTally()]));
  const byPair = new Map<string, Tally>();
  const byStyle = new Map<Style, Tally>(config.styles.map((style) => [style, newTally()]));
  const byTier = new Map<Tier, Tally>(([0, 1, 2, 3, 4] as const).map((tier) => [tier, newTally()]));
  const energyByRound = new Map<number, { score: number; energy: number }>();

  let twoNil = 0;
  let twoOne = 0;
  let tiebreak = 0;
  let drawRounds = 0;
  let totalRounds = 0;

  for (let index = 0; index < options.matches; index += 1) {
    const [leftId, rightId] = pairs[index % pairs.length]!;
    const match = simulateMatch(
      deriveSeed(options.seed, 'match', index),
      { a: STRATEGIES[leftId], b: STRATEGIES[rightId] },
      { config },
    );

    const pointsFor = (seat: Seat): number =>
      match.result.winner === null ? 0.5 : match.result.winner === seat ? 1 : 0;

    for (const [seat, id] of [
      ['a', leftId],
      ['b', rightId],
    ] as const) {
      const tally = byStrategy.get(id)!;
      tally.games += 1;
      tally.points += pointsFor(seat);
    }

    const pairKey = `${leftId} vs ${rightId}`;
    const pairTally = byPair.get(pairKey) ?? newTally();
    pairTally.games += 1;
    pairTally.points += pointsFor('a');
    byPair.set(pairKey, pairTally);

    if (match.result.reason === 'rounds') {
      const loserRounds = Math.min(match.result.roundsWon.a, match.result.roundsWon.b);
      if (loserRounds === 0) twoNil += 1;
      else twoOne += 1;
    } else {
      tiebreak += 1;
    }

    match.rounds.forEach((round, roundIndex) => {
      totalRounds += 1;
      if (round.winner === null) drawRounds += 1;

      const energy = energyByRound.get(roundIndex + 1) ?? { score: 0, energy: 0 };
      for (const seat of SEATS) {
        const move = match.moves[seat][roundIndex];
        if (move === undefined) continue;
        const points = round.winner === null ? 0.5 : round.winner === seat ? 1 : 0;

        const styleTally = byStyle.get(move.style)!;
        styleTally.games += 1;
        styleTally.points += points;

        const tierTally = byTier.get(move.tier)!;
        tierTally.games += 1;
        tierTally.points += points;

        energy.score += round.seats[seat].score;
        energy.energy += round.seats[seat].energySpent;
      }
      energyByRound.set(roundIndex + 1, energy);
    });
  }

  // Mesure dediee : meme strategie des deux cotes, seule l'adresse au timing
  // change. C'est le seul moyen d'isoler ce que vaut un bon timing.
  const timingMatches = Math.max(50, Math.floor(options.matches / 2));
  let timingWins = 0;
  for (let index = 0; index < timingMatches; index += 1) {
    const match = simulateMatch(
      deriveSeed(options.seed, 'timing', index),
      { a: STRATEGIES.random, b: STRATEGIES.random },
      {
        config,
        skill: { a: { perfect: 0.6, good: 0.3 }, b: { perfect: 0.2, good: 0.4 } },
      },
    );
    timingWins += match.result.winner === 'a' ? 1 : match.result.winner === null ? 0.5 : 0;
  }

  const fromMap = <K extends string | number>(map: Map<K, Tally>): Record<K, number> =>
    Object.fromEntries([...map].map(([key, tally]) => [key, rate(tally)])) as Record<K, number>;

  return {
    matches: options.matches,
    winRateByStrategy: fromMap(byStrategy),
    winRateByPair: fromMap(byPair),
    winRateByStyle: fromMap(byStyle),
    winRateByTier: fromMap(byTier),
    finishes: { twoNil, twoOne, tiebreak },
    drawRoundRate: totalRounds === 0 ? 0 : drawRounds / totalRounds,
    timingAdvantage: timingMatches === 0 ? 0 : timingWins / timingMatches,
    energyValueByRound: Object.fromEntries(
      [...energyByRound].map(([round, totals]) => [
        round,
        totals.energy === 0 ? 0 : totals.score / totals.energy,
      ]),
    ),
  };
}
