import { BALANCE, type BalanceConfig } from '../balance.js';
import { beatersOf } from '../counters.js';
import type { Rng } from '../rng.js';
import type { AmplifierLevel, Choice, Move, Style, Tier } from '../types.js';

/**
 * Strategies d'equilibrage (docs/09-testing.md).
 *
 * Ce ne sont pas des adversaires de jeu mais des sondes : chacune pousse une
 * facon de depenser l'energie a l'extreme, pour verifier qu'aucune ne domine.
 * Elles partagent la meme adresse au timing, pour que la seule variable
 * mesuree soit la politique de choix.
 */

export type StrategyId = 'random' | 'greedy' | 'counter' | 'thrifty' | 'allin' | 'shinyChaser';

export const STRATEGY_IDS: readonly StrategyId[] = [
  'random',
  'greedy',
  'counter',
  'thrifty',
  'allin',
  'shinyChaser',
];

export interface StrategyContext {
  readonly rng: Rng;
  readonly energy: number;
  readonly ultimateGauge: number;
  readonly previousMoves: readonly Move[];
  readonly opponentStyles: readonly Style[];
  readonly round: number;
  readonly roundsWon: number;
  readonly opponentRoundsWon: number;
  /** La case brillante du siege pour cette manche (docs/01). */
  readonly shiny?: Move;
}

/**
 * Tout ce dont le simulateur a besoin pour faire jouer un siege.
 *
 * Separe de `Strategy` parce que le simulateur n'appelle jamais que cette
 * methode : `id` et `name` n'existent que pour le rapport de tournoi. Les
 * sondes de mesure du skill (`skill.ts`) ne font pas partie de ce rapport et
 * n'ont donc pas d'identifiant a y porter.
 */
export interface ChoicePolicy {
  decideChoice(context: StrategyContext, config?: BalanceConfig): Choice;
}

export interface Strategy extends ChoicePolicy {
  readonly id: StrategyId;
  readonly name: string;
}

/**
 * Repartit un budget entre palier et amplificateur.
 * Le palier passe en premier : sa puissance croit plus vite que le
 * multiplicateur de l'amplificateur a cout egal.
 */
function splitSpend(spend: number): { tier: Tier; amplifier: AmplifierLevel } {
  const tier = Math.max(0, Math.min(4, spend)) as Tier;
  const amplifier = Math.max(0, Math.min(4, spend - tier)) as AmplifierLevel;
  return { tier, amplifier };
}

/**
 * Une famille qui bat celle passee en parametre.
 *
 * Il y en a deux dans la roue a cinq : on tire au sort avec le RNG seede, pour
 * rester deterministe sans devenir previsible.
 */
function beaterOf(style: Style, rng: Rng, config: BalanceConfig): Style {
  return rng.pick(beatersOf(style, config));
}

const build = (
  id: StrategyId,
  name: string,
  decide: (context: StrategyContext, config: BalanceConfig) => { style: Style; spend: number },
): Strategy => ({
  id,
  name,
  decideChoice(context, config = BALANCE) {
    const { style, spend } = decide(context, config);
    const budget = Math.max(0, Math.min(spend, context.energy, config.maxRoundCost));
    const { tier, amplifier } = splitSpend(budget);
    return {
      move: { style, tier },
      amplifier,
      useUltimate: context.ultimateGauge >= config.ultimate.gaugeMax,
    };
  },
});

export const STRATEGIES: Readonly<Record<StrategyId, Strategy>> = Object.freeze({
  // Reference : sans elle, aucun chiffre de victoire ne veut rien dire.
  random: build('random', 'Aleatoire', (context, config) => ({
    style: context.rng.pick(config.styles),
    spend: context.rng.nextInt(0, config.maxRoundCost),
  })),

  // Brule tout, tout de suite : teste si la puissance brute suffit a gagner.
  greedy: build('greedy', 'Glouton', (context, config) => ({
    style: context.rng.pick(config.styles),
    spend: config.maxRoundCost,
  })),

  // Joue la lecture plutot que la puissance : teste la valeur du contre.
  counter: build('counter', 'Contre-picker', (context, config) => {
    const last = context.opponentStyles.at(-1);
    return {
      style:
        last === undefined ? context.rng.pick(config.styles) : beaterOf(last, context.rng, config),
      spend: 4,
    };
  }),

  // Garde son energie pour la belle : teste la valeur de l'energie tardive.
  thrifty: build('thrifty', 'Econome', (context, config) => ({
    style: context.rng.pick(config.styles),
    spend: context.round >= config.match.maxRounds ? context.energy : 2,
  })),

  // Joue sa brillante des qu'il le peut : teste que la chance ne domine pas
  // la lecture (elle doit rester sous le contre-picker).
  shinyChaser: build('shinyChaser', 'Chasseur de brillantes', (context, config) => {
    const shiny = context.shiny;
    if (shiny !== undefined && config.tierCost[shiny.tier] <= context.energy) {
      return { style: shiny.style, spend: shiny.tier };
    }
    return { style: context.rng.pick(config.styles), spend: 4 };
  }),

  // Mise tout sur la premiere manche, puis subit : teste la variance extreme.
  allin: build('allin', 'Tout sur une manche', (context, config) => ({
    style: context.rng.pick(config.styles),
    spend: context.round === 1 ? config.maxRoundCost : 0,
  })),
});
