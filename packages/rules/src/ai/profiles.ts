import { BALANCE, type BalanceConfig } from '../balance.js';
import { beatersOf } from '../counters.js';
import type { Orb, RechargeTap } from '../recharge.js';
import type { Rng } from '../rng.js';
import { choiceCost, isChoiceAffordable } from '../round.js';
import type { GaugeParams } from '../timing.js';
import type { AmplifierLevel, Choice, Move, Style, Tier } from '../types.js';

/**
 * IA solo — portage des quatre adversaires du prototype (docs/01 §11).
 *
 * Dans le prototype, chaque adversaire avait ses propres poses et sa propre
 * jauge de timing : il etait litteralement plus fort parce qu'il jouait sur un
 * autre plateau. Les regles actuelles l'interdisent — la jauge est tiree par le
 * serveur et commune aux deux joueurs, et tous les paliers sont accessibles a
 * tous. La difference de niveau ne vient donc plus que du comportement.
 */

export type AiProfileId = 'rookie' | 'mystery' | 'calm' | 'untouchable';

export const AI_PROFILE_IDS: readonly AiProfileId[] = ['rookie', 'mystery', 'calm', 'untouchable'];

export interface AiProfile {
  readonly id: AiProfileId;
  readonly name: string;
  readonly description: string;
  /** Probabilites de viser « parfait » puis « bon » sur la jauge. Le reste est rate. */
  readonly skill: { readonly perfect: number; readonly good: number };
  /** Probabilite de lire le dernier style adverse et de le contrer. */
  readonly read: number;
  /** Fourchette du nombre de taps a la recharge. */
  readonly rechargeTaps: readonly [number, number];
  /** Part du cout maximal d'une manche qu'il accepte de depenser. */
  readonly aggression: number;
  /** Le debutant ne sait pas encore se servir de l'Ultime. */
  readonly usesUltimate: boolean;
  /**
   * Probabilite de viser sa carte brillante quand elle est abordable.
   * Absent : 0,35, une manche sur trois environ.
   */
  readonly shinyAppetite?: number;
}

export const AI_PROFILES: Readonly<Record<AiProfileId, AiProfile>> = Object.freeze({
  rookie: {
    id: 'rookie',
    name: 'Le Nouveau',
    description: 'Il debute. Ses intentions se lisent sur son visage.',
    skill: { perfect: 0.05, good: 0.45 },
    read: 0,
    rechargeTaps: [8, 12],
    aggression: 0.25,
    usesUltimate: false,
  },
  mystery: {
    id: 'mystery',
    name: 'Le Mysterieux',
    description: 'Difficile a lire. Il bluffe de temps en temps.',
    skill: { perfect: 0.15, good: 0.55 },
    read: 0.2,
    rechargeTaps: [11, 16],
    aggression: 0.4,
    usesUltimate: true,
  },
  calm: {
    id: 'calm',
    name: 'Le Calme Absolu',
    description: 'Il observe ton style pour mieux te contrer.',
    skill: { perfect: 0.3, good: 0.5 },
    read: 0.4,
    rechargeTaps: [14, 19],
    aggression: 0.55,
    usesUltimate: true,
  },
  untouchable: {
    id: 'untouchable',
    name: "L'Intouchable",
    description: 'Il lit dans tes pensees et ment sur les siennes.',
    skill: { perfect: 0.5, good: 0.4 },
    read: 0.55,
    rechargeTaps: [17, 23],
    aggression: 0.7,
    usesUltimate: true,
  },
});

/** Ecart minimal ajoute pour ne pas retomber pile sur une frontiere de qualite. */
const JUST_OUTSIDE = 1e-6;

/** Adresse au timing : probabilites d'atteindre « parfait » puis « bon ». */
export interface TimingSkill {
  readonly perfect: number;
  readonly good: number;
}

/**
 * Instant de tap qui reproduit un ecart donne sur cette jauge.
 *
 * C'est l'inverse de `evaluateTiming` : celle-ci lit un instant et en rend un
 * ecart, celle-ci part de l'ecart voulu et remonte a l'instant. On vise la
 * **premiere** montee du curseur, celle qui part de zero — toutes les suivantes
 * donnent le meme ecart, et la premiere est la seule qui tienne toujours sous
 * `maxChargeMs`.
 *
 * L'ecart demande est ramene a ce que la jauge peut produire. Un curseur qui
 * parcourt `[0, 1]` ne s'ecarte jamais de son centre de plus de
 * `max(centre, 1 - centre)` : un ecart enregistre sur une jauge decentree n'est
 * pas toujours atteignable sur une jauge centree. Rabattre vaut mieux que
 * rendre un instant qui produirait un tout autre ecart.
 */
export function tapAtMsForDelta(
  delta: number,
  gauge: GaugeParams,
  config: BalanceConfig = BALANCE,
): number {
  const reachable = Math.max(gauge.center, 1 - gauge.center);
  const bounded = Math.min(Math.max(0, delta), reachable);
  const position = gauge.center + bounded <= 1 ? gauge.center + bounded : gauge.center - bounded;
  const tapAtMs = (Math.max(0, position) * gauge.periodMs) / 2;
  return Math.min(tapAtMs, config.timing.maxChargeMs);
}

/**
 * Trouve un instant de tap qui produit la qualite voulue.
 *
 * On tire d'abord la qualite visee, puis on inverse l'onde triangulaire pour
 * remonter a l'instant correspondant. Le joueur simule ne « vise » donc pas :
 * il decide du resultat, ce qui le rend exactement reglable et testable.
 */
export function timingTapForSkill(
  skill: TimingSkill,
  gauge: GaugeParams,
  rng: Rng,
  config: BalanceConfig = BALANCE,
): number {
  const perfectEdge = gauge.perfectWidth / 2;
  const goodEdge = gauge.zoneWidth / 2;
  const roll = rng.nextFloat();

  const delta =
    roll < skill.perfect
      ? rng.nextFloat() * perfectEdge
      : roll < skill.perfect + skill.good
        ? perfectEdge + JUST_OUTSIDE + rng.nextFloat() * (goodEdge - perfectEdge - JUST_OUTSIDE)
        : goodEdge + JUST_OUTSIDE + rng.nextFloat() * (0.5 - goodEdge);

  return tapAtMsForDelta(delta, gauge, config);
}

/**
 * Suite de taps reguliers sur les premieres orbes.
 *
 * La cadence est calee pour que l'orbe visee soit toujours en vie : une orbe
 * doree ne vit que 950 ms et trois taps la separent de son apparition, donc la
 * cadence ne depasse jamais 300 ms. Elle reste aussi tres en dessous du plafond
 * de 12 taps par seconde : le joueur simule ne triche pas.
 */
export function rechargeTapsForCount(
  count: number,
  orbs: readonly Orb[],
  config: BalanceConfig = BALANCE,
): readonly RechargeTap[] {
  const total = Math.min(count, orbs.length);
  const cadenceMs = Math.min(300, config.recharge.durationMs / (total + 1));
  return Array.from({ length: total }, (_unused, index) => ({
    atMs: (index + 1) * cadenceMs,
    orbIndex: orbs[index]!.index,
  }));
}

/** Choisit l'instant du tap sur la jauge, selon l'adresse du profil. */
export function decideTimingTap(
  profile: AiProfile,
  gauge: GaugeParams,
  rng: Rng,
  config: BalanceConfig = BALANCE,
): number {
  return timingTapForSkill(profile.skill, gauge, rng, config);
}

/** Choisit la suite de taps de la recharge, selon la fourchette du profil. */
export function decideRechargeTaps(
  profile: AiProfile,
  orbs: readonly Orb[],
  rng: Rng,
  config: BalanceConfig = BALANCE,
): readonly RechargeTap[] {
  const [min, max] = profile.rechargeTaps;
  return rechargeTapsForCount(rng.nextInt(min, max), orbs, config);
}

export interface AiChoiceContext {
  readonly profile: AiProfile;
  readonly rng: Rng;
  readonly energy: number;
  readonly ultimateGauge: number;
  /** Mouvements deja joues par l'IA, pour eviter la penalite de repetition. */
  readonly previousMoves: readonly Move[];
  /** Styles joues par l'adversaire, du plus ancien au plus recent. */
  readonly opponentStyles: readonly Style[];
  readonly round: number;
  /** La case brillante de l'IA pour cette manche, si le moteur l'a tiree. */
  readonly shiny?: Move;
}

/** Appetit par defaut pour la carte brillante. */
const DEFAULT_SHINY_APPETITE = 0.35;

const TIERS: readonly Tier[] = [0, 1, 2, 3, 4];

/**
 * Une famille qui bat celle passee en parametre.
 *
 * Il y en a deux dans la roue a cinq : on tire au sort avec le RNG seede, pour
 * rester deterministe sans devenir previsible.
 */
function beaterOf(style: Style, rng: Rng, config: BalanceConfig): Style {
  return rng.pick(beatersOf(style, config));
}

const alreadyPlayed = (move: Move, previousMoves: readonly Move[]): boolean =>
  previousMoves.some((played) => played.style === move.style && played.tier === move.tier);

/**
 * Mouvement et amplificateur qui tiennent dans un budget, au plus pres du
 * palier vise.
 *
 * **La politique d'adaptation du jeu simule vit ici, une fois.** L'IA solo s'en
 * sert pour depenser son budget de manche ; le rejeu d'un fantome s'en sert
 * pour rabattre un choix enregistre devenu impayable (`affordableChoice`,
 * docs/05 § « Fantomes » : « avec la meme politique que l'IA solo »). Deux
 * copies de cette politique divergeraient, et l'une des deux finirait par
 * proposer un choix que le moteur refuse.
 *
 * Rejouer le meme mouvement coute 30 % du score : on decale d'abord le palier,
 * puis le style, et on ne se repete qu'une fois toutes les options epuisees.
 */
function fitChoice(
  style: Style,
  desiredTier: Tier,
  spend: number,
  previousMoves: readonly Move[],
  config: BalanceConfig,
): { readonly move: Move; readonly amplifier: AmplifierLevel } {
  const affordableTier = (candidate: Tier): boolean => config.tierCost[candidate] <= spend;
  const fresh = (candidateStyle: Style, candidateTier: Tier): boolean =>
    !alreadyPlayed({ style: candidateStyle, tier: candidateTier }, previousMoves);

  const sameStyleAlternatives = TIERS.filter(
    (candidate) => affordableTier(candidate) && fresh(style, candidate),
  ).sort((left, right) => Math.abs(left - desiredTier) - Math.abs(right - desiredTier));

  const otherStyleAlternatives = config.styles
    .filter((candidate) => candidate !== style)
    .flatMap((candidateStyle) =>
      TIERS.filter(
        (candidate) => affordableTier(candidate) && fresh(candidateStyle, candidate),
      ).map((candidateTier) => ({ style: candidateStyle, tier: candidateTier })),
    )
    .sort((left, right) => Math.abs(left.tier - desiredTier) - Math.abs(right.tier - desiredTier));

  const move: Move = fresh(style, desiredTier)
    ? { style, tier: desiredTier }
    : sameStyleAlternatives[0] !== undefined
      ? { style, tier: sameStyleAlternatives[0] }
      : (otherStyleAlternatives[0] ?? { style, tier: desiredTier });

  return {
    move,
    amplifier: Math.min(4, Math.max(0, spend - config.tierCost[move.tier])) as AmplifierLevel,
  };
}

/** Ce qu'il faut savoir d'un siege pour savoir ce qu'il peut encore jouer. */
export interface AffordabilityContext {
  readonly energy: number;
  readonly ultimateGauge: number;
  /** Mouvements deja joues, pour eviter la penalite de repetition. */
  readonly previousMoves: readonly Move[];
}

/**
 * Rabat un choix voulu sur ce que le siege peut reellement payer.
 *
 * Sert au rejeu d'un fantome (docs/05) : un enregistrement est une suite de
 * choix joues dans **une autre** partie, ou l'energie n'a pas suivi le meme
 * chemin. Le choix d'origine peut donc etre impayable ici. Plutot que de le
 * refuser — le fantome jouerait alors le choix par defaut, c'est-a-dire rien —
 * on le ramene dans le budget avec la politique de l'IA solo : meme style, le
 * palier le plus proche que l'energie couvre, et le reste en amplificateur.
 *
 * L'Ultime suit la meme logique : il n'est conserve que si la jauge est pleine,
 * exactement comme le moteur l'exigerait (`ULTIMATE_NOT_READY`).
 *
 * Le repli final n'est pas de la ceinture-bretelles : `fitChoice` rend le
 * palier vise quand plus aucune option fraiche n'existe, et ce palier peut
 * depasser le budget. Un choix refuse par le moteur ne serait pas un mauvais
 * choix, ce serait **aucun** choix.
 */
export function affordableChoice(
  desired: Choice,
  context: AffordabilityContext,
  config: BalanceConfig = BALANCE,
): Choice {
  const spend = Math.min(context.energy, choiceCost(desired, config));
  const fitted = fitChoice(
    desired.move.style,
    desired.move.tier,
    spend,
    context.previousMoves,
    config,
  );

  const choice: Choice = {
    move: fitted.move,
    amplifier: fitted.amplifier,
    useUltimate: desired.useUltimate && context.ultimateGauge >= config.ultimate.gaugeMax,
  };

  return isChoiceAffordable(choice, context.energy, config)
    ? choice
    : { move: { style: desired.move.style, tier: 0 }, amplifier: 0, useUltimate: false };
}

export function decideChoice(context: AiChoiceContext, config: BalanceConfig = BALANCE): Choice {
  const { profile, rng, energy, previousMoves, opponentStyles } = context;
  const useUltimate = profile.usesUltimate && context.ultimateGauge >= config.ultimate.gaugeMax;

  // La carte brillante : viser sa case une manche sur trois, si elle est
  // abordable. Le reste du budget va a l'amplificateur.
  const shiny = context.shiny;
  if (
    shiny !== undefined &&
    config.tierCost[shiny.tier] <= energy &&
    rng.chance(profile.shinyAppetite ?? DEFAULT_SHINY_APPETITE)
  ) {
    const budget = Math.min(energy, Math.round(config.maxRoundCost * profile.aggression));
    const extra = Math.max(0, Math.min(4, budget - config.tierCost[shiny.tier])) as AmplifierLevel;
    return { move: shiny, amplifier: extra, useUltimate };
  }

  const lastOpponentStyle = opponentStyles.at(-1);
  const style: Style =
    lastOpponentStyle !== undefined && rng.chance(profile.read)
      ? beaterOf(lastOpponentStyle, rng, config)
      : rng.pick(config.styles);

  // Budget de la manche : une IA agressive brule son energie tot, une prudente
  // la garde pour la belle.
  const budget = Math.min(energy, Math.round(config.maxRoundCost * profile.aggression));
  const spend = budget <= 0 ? 0 : rng.nextInt(Math.ceil(budget / 2), budget);
  const desiredTier = Math.min(TIERS.length - 1, spend) as Tier;

  const { move, amplifier } = fitChoice(style, desiredTier, spend, previousMoves, config);

  return { move, amplifier, useUltimate };
}
