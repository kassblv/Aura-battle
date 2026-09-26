import type { TimingSkill } from '../ai/profiles.js';
import { BALANCE, type BalanceConfig } from '../balance.js';
import { beatersOf } from '../counters.js';
import type { Rng } from '../rng.js';
import type { AmplifierLevel, Choice, Seat, Style, Tier } from '../types.js';
import { simulateMatch } from './simulate.js';
import type { ChoicePolicy, StrategyContext } from './strategies.js';

/**
 * Mesure du skill (docs/00-vision.md, docs/09-testing.md).
 *
 * Le tournoi de `simulate.ts` repond a « une facon de depenser l'energie
 * domine-t-elle ? ». Ce module repond a une autre question, qui n'est pas la
 * meme : **le talent paie-t-il ?** Chaque mesure est un duel ou une seule
 * variable differe entre les deux sieges, pour que le taux de victoire lise
 * cette variable et rien d'autre.
 *
 * C'est le garde-fou chiffre de l'intention produite : « le talent et la
 * reflexion priment ». Une modification de `balance.ts` qui fait tomber la
 * mesure `talent` vers 50 % a rendu l'energie plus decisive que le jeu, meme
 * si tous les seuils du tournoi restent verts.
 */

export type SkillMeasureId = 'timing' | 'lecture' | 'budget' | 'talent';

export const SKILL_MEASURE_IDS: readonly SkillMeasureId[] = [
  'timing',
  'lecture',
  'budget',
  'talent',
];

/** Adresse au timing d'un joueur qui vise juste, puis d'un joueur maladroit. */
const SHARP: TimingSkill = { perfect: 0.6, good: 0.3 };
const CLUMSY: TimingSkill = { perfect: 0.2, good: 0.5 };
/** Reference neutre, pour les duels ou le timing n'est pas la variable. */
const EVEN: TimingSkill = { perfect: 0.3, good: 0.5 };

/**
 * Budget par manche des sondes.
 *
 * `LEAN` est le budget du talent, `RICH` le maximum autorise. L'ecart est
 * volontairement du simple au double : c'est le pire cas realiste, celui ou le
 * joueur qui depense tout affronte celui qui doit economiser.
 */
const LEAN = 4;
const RICH = 8;

/**
 * Repartit un budget entre palier et amplificateur, comme les strategies.
 *
 * Le palier passe en premier : a cout egal sa puissance croit plus vite que le
 * multiplicateur de l'amplificateur. Il sature a 4, donc tout budget superieur
 * part entierement dans l'amplificateur — c'est precisement ce que la mesure
 * `talent` sert a surveiller.
 */
function split(spend: number): { tier: Tier; amplifier: AmplifierLevel } {
  const tier = Math.max(0, Math.min(4, spend)) as Tier;
  return { tier, amplifier: Math.max(0, Math.min(4, spend - tier)) as AmplifierLevel };
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

/**
 * Fabrique une sonde a partir d'une politique de style et d'un budget fixe.
 *
 * Le budget est constant d'une manche a l'autre, contrairement aux strategies
 * du tournoi : une sonde dont la depense varie melangerait la gestion de
 * l'energie a la variable mesuree.
 */
function probe(
  spend: number,
  pickStyle: (context: StrategyContext, config: BalanceConfig) => Style,
): ChoicePolicy {
  return {
    decideChoice(context, config = BALANCE): Choice {
      const budget = Math.max(0, Math.min(spend, context.energy, config.maxRoundCost));
      const { tier, amplifier } = split(budget);
      return {
        move: { style: pickStyle(context, config), tier },
        amplifier,
        useUltimate: context.ultimateGauge >= config.ultimate.gaugeMax,
      };
    },
  };
}

/** Style tire au hasard : rien a lire pour l'adversaire. */
const unreadable = (spend: number): ChoicePolicy =>
  probe(spend, (context, config) => context.rng.pick(config.styles));

/**
 * Style previsible : le meme trois fois sur quatre.
 *
 * Un adversaire totalement aleatoire rendrait la lecture inutile par
 * construction, et la mesure `lecture` tournerait autour de 50 % quelle que
 * soit la valeur du contre. Il faut donc quelque chose a lire.
 */
const readable = (spend: number, favourite: Style, bias = 0.75): ChoicePolicy =>
  probe(spend, (context, config) =>
    context.rng.chance(bias) ? favourite : context.rng.pick(config.styles),
  );

/** Contre le dernier style joue par l'adversaire. */
const reader = (spend: number): ChoicePolicy =>
  probe(spend, (context, config) => {
    const last = context.opponentStyles.at(-1);
    return last === undefined
      ? context.rng.pick(config.styles)
      : beaterOf(last, context.rng, config);
  });

interface Side {
  readonly policy: ChoicePolicy;
  readonly skill: TimingSkill;
}

interface Duel {
  readonly id: SkillMeasureId;
  readonly name: string;
  readonly question: string;
  readonly left: Side;
  readonly right: Side;
}

const DUELS: readonly Duel[] = [
  {
    id: 'timing',
    name: 'Timing',
    question: 'Que vaut la jauge de timing, a choix et budget identiques ?',
    left: { policy: unreadable(LEAN), skill: SHARP },
    right: { policy: unreadable(LEAN), skill: CLUMSY },
  },
  {
    id: 'lecture',
    name: 'Lecture',
    question: 'Que vaut le contre, face a un adversaire previsible ?',
    left: { policy: reader(LEAN), skill: EVEN },
    right: { policy: readable(LEAN, 'hype'), skill: EVEN },
  },
  {
    id: 'budget',
    name: 'Budget',
    question: 'Que vaut le double de budget, a talent identique ?',
    left: { policy: unreadable(RICH), skill: EVEN },
    right: { policy: unreadable(LEAN), skill: EVEN },
  },
  {
    id: 'talent',
    name: 'Talent contre budget',
    question: 'Qui gagne : lire et viser juste, ou depenser deux fois plus ?',
    left: { policy: reader(LEAN), skill: SHARP },
    right: { policy: readable(RICH, 'hype'), skill: CLUMSY },
  },
];

export interface SkillMeasure {
  readonly id: SkillMeasureId;
  readonly name: string;
  readonly question: string;
  /** Victoires de la sonde de gauche, sur l'ensemble des matchs du duel. */
  readonly winRate: number;
}

export interface SkillReport {
  readonly matches: number;
  readonly seed: string;
  readonly measures: readonly SkillMeasure[];
  /**
   * Victoires de la sonde de gauche dans un duel entre deux sondes identiques.
   *
   * Temoin de la mesure : il doit rester proche de 50 %. Tout ecart durable est
   * un biais de siege du moteur, et serait compte comme du talent par les
   * quatre autres lignes.
   */
  readonly seatBias: number;
}

export interface SkillOptions {
  readonly matches: number;
  readonly seed: string;
  readonly config?: BalanceConfig;
}

/**
 * Joue un duel et rend le taux de victoire de la sonde de gauche.
 *
 * Les sondes **changent de siege a mi-parcours**. Le moteur est cense etre
 * symetrique, mais c'est justement ce qu'on ne veut pas supposer ici : sans
 * cette alternance, un biais de siege serait lu comme un effet du talent.
 */
function duel(duelToPlay: Duel, options: SkillOptions): number {
  const { matches, seed } = options;
  const config = options.config ?? BALANCE;
  let wins = 0;

  for (let index = 0; index < matches; index += 1) {
    const swapped = index >= Math.floor(matches / 2);
    const left: Seat = swapped ? 'b' : 'a';
    const right: Seat = swapped ? 'a' : 'b';
    const { result } = simulateMatch(
      `${seed}:${duelToPlay.id}:${String(index)}`,
      { [left]: duelToPlay.left.policy, [right]: duelToPlay.right.policy } as Record<
        Seat,
        ChoicePolicy
      >,
      {
        config,
        skill: { [left]: duelToPlay.left.skill, [right]: duelToPlay.right.skill } as Record<
          Seat,
          TimingSkill
        >,
      },
    );
    if (result.winner === left) wins += 1;
  }

  return wins / matches;
}

/** Temoin : deux sondes strictement identiques, pour lire le biais de siege. */
const CONTROL: Duel = {
  id: 'timing',
  name: 'Temoin',
  question: 'Deux sondes identiques : le siege change-t-il quelque chose ?',
  left: { policy: unreadable(LEAN), skill: EVEN },
  right: { policy: unreadable(LEAN), skill: EVEN },
};

export function measureSkill(options: SkillOptions): SkillReport {
  return {
    matches: options.matches,
    seed: options.seed,
    measures: DUELS.map((toPlay) => ({
      id: toPlay.id,
      name: toPlay.name,
      question: toPlay.question,
      winRate: duel(toPlay, options),
    })),
    seatBias: duel({ ...CONTROL, id: 'budget' }, { ...options, seed: `${options.seed}:temoin` }),
  };
}
