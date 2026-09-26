import {
  decideChoice,
  rechargeTapsForCount,
  timingTapForSkill,
  type AiProfile,
  type TimingSkill,
} from '../ai/profiles.js';
import { BALANCE, type BalanceConfig } from '../balance.js';
import {
  createMatch,
  reduce,
  type MatchEvent,
  type MatchResult,
  type MatchState,
} from '../match.js';
import type { RechargeResult } from '../recharge.js';
import { createRng, deriveSeed, type Rng } from '../rng.js';
import type { RoundResult } from '../round.js';
import type { TimingResult } from '../timing.js';
import type { Choice, Move, Seat, Style, Tier } from '../types.js';
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

/**
 * Ce qu'un siege a joue dans une manche, tel que le moteur l'a vu.
 *
 * `RoundResult` dit ce que la manche a **donne** ; ceci dit ce qui a ete
 * **joue**. La difference compte des qu'on veut rejouer un comportement
 * ailleurs : le resultat depend des orbes et de la jauge de cette manche-la,
 * le comportement non.
 *
 * Preleve au moment ou la manche se resout, parce que c'est le seul ou
 * l'information existe encore : la manche suivante remet `pending` a zero.
 */
export interface PlayedRound {
  readonly choice: Choice;
  readonly timing: TimingResult;
  /** Evaluation de la recharge, ou `null` si la phase n'a rien produit. */
  readonly recharge: RechargeResult | null;
  /** Nombre de taps retenus par le moteur pour cette recharge. */
  readonly rechargeTaps: number;
}

export interface MatchSimulation {
  readonly result: MatchResult;
  readonly rounds: readonly RoundResult[];
  readonly finalEnergy: Readonly<Record<Seat, number>>;
  readonly moves: Readonly<Record<Seat, readonly Move[]>>;
  /**
   * Ce que chaque siege a joue, manche par manche.
   *
   * Sert a produire des enregistrements de fantome a partir d'un profil d'IA
   * (docs/05 § « Fantomes ») : le vivier de depart doit exister avant le
   * premier match humain, sinon la fonctionnalite qui empeche une file vide ne
   * marche pas le jour ou la file est vide.
   */
  readonly played: Readonly<Record<Seat, readonly PlayedRound[]>>;
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
  const played: Record<Seat, PlayedRound[]> = { a: [], b: [] };

  /**
   * Applique un evenement, et preleve la manche si elle vient de se resoudre.
   *
   * Le prelevement se fait **ici** et pas apres la boucle : quand
   * `ROUND_RESOLVED` est emis, `pending` porte encore les choix et la recharge
   * de la manche ; la transition suivante les efface. C'est le meme instant, et
   * pour la meme raison, que celui ou le serveur lit sa trace de fantome.
   */
  const advance = (state: MatchState, event: MatchEvent): void => {
    step = reduce(state, event, config);
    if (!step.effects.some((effect) => effect.type === 'ROUND_RESOLVED')) return;

    for (const seat of SEATS) {
      const pending = step.state.pending[seat];
      const resolved = step.state.history.at(-1);
      if (resolved === undefined) continue;
      /**
       * Sans verrouillage, le moteur a joue l'action par defaut : palier 0
       * d'un style tire par la graine (§9). On lit ce qu'il **a** joue —
       * `moves` vient d'etre alimente par la resolution — plutot que de
       * refabriquer ce choix ici, ce qui serait reimplementer la regle.
       */
      const move = step.state.seats[seat].moves.at(-1);
      if (move === undefined) continue;

      played[seat].push({
        choice: pending.locked?.choice ?? { move, amplifier: 0, useUltimate: false },
        timing: resolved.seats[seat].timing,
        recharge: pending.recharge,
        rechargeTaps: pending.taps.length,
      });
    }
  };

  while (step.state.phase !== 'ended' && transitions < MAX_TRANSITIONS) {
    transitions += 1;
    const state: MatchState = step.state;

    switch (state.phase) {
      case 'intro':
      case 'reveal':
        advance(state, { type: 'PHASE_TIMEOUT', atMs: state.phaseEndsAtMs });
        break;

      case 'recharge': {
        const orbs = state.roundContext?.orbs ?? [];
        for (const seat of SEATS) {
          const taps = rechargeTapsForCount(rng[seat].nextInt(minTaps, maxTaps), orbs, config);
          advance(step.state, { type: 'RECHARGE_TAPS', seat, taps, atMs: 0 });
        }
        advance(step.state, { type: 'PHASE_TIMEOUT', atMs: step.state.phaseEndsAtMs });
        break;
      }

      case 'choice': {
        const gauge = state.roundContext?.gauge;
        if (gauge === undefined) {
          advance(state, { type: 'PHASE_TIMEOUT', atMs: state.phaseEndsAtMs });
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
              ...(current.roundContext === null ? {} : { shiny: current.roundContext.shiny[seat] }),
            },
            config,
          );
          advance(current, {
            type: 'CHOICE_LOCKED',
            seat,
            choice,
            timingTapAtMs: timingTapForSkill(skill[seat], gauge, rng[seat], config),
            atMs: current.phaseEndsAtMs - 1_000,
          });
          // Un choix refuse laisserait le siege bloque : on retombe sur le
          // mouvement gratuit plutot que de tourner en rond.
          if (step.effects.some((effect) => effect.type === 'CHOICE_REJECTED')) {
            advance(step.state, {
              type: 'CHOICE_LOCKED',
              seat,
              choice: {
                move: { style: choice.move.style, tier: 0 },
                amplifier: 0,
                useUltimate: false,
              },
              timingTapAtMs: timingTapForSkill(skill[seat], gauge, rng[seat], config),
              atMs: current.phaseEndsAtMs - 1_000,
            });
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
    played: { a: played.a, b: played.b },
  };
}

/**
 * Fait jouer un profil d'IA contre lui-meme, un match entier.
 *
 * Sert a produire des enregistrements de fantome **avant** qu'un seul match
 * humain ait ete joue (docs/05 § « Fantomes »). Le miroir n'est pas une
 * facilite : les deux sieges suivent la meme courbe d'energie et la meme
 * adresse, donc le jeu enregistre est celui de ce niveau-la, et pas celui d'un
 * joueur qu'un adversaire plus fort aurait etrangle.
 *
 * Toute la difference entre profils passe par le **comportement** — adresse au
 * timing, cadence de recharge, agressivite, usage de l'Ultime — jamais par les
 * regles : ils affrontent la meme jauge et la meme sequence d'orbes que
 * n'importe qui (docs/01 §11).
 *
 * Deterministe : meme graine, meme profil, meme match. Un vivier de depart doit
 * pouvoir etre regenere a l'identique.
 */
export function simulateProfileMatch(
  seed: string,
  profile: AiProfile,
  config: BalanceConfig = BALANCE,
): MatchSimulation {
  const policy: ChoicePolicy = {
    decideChoice: (context, overrides) =>
      decideChoice({ ...context, profile }, overrides ?? config),
  };

  return simulateMatch(
    seed,
    { a: policy, b: policy },
    {
      config,
      skill: { a: profile.skill, b: profile.skill },
      rechargeTaps: profile.rechargeTaps,
    },
  );
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
