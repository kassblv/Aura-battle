import { BALANCE, type BalanceConfig } from '../balance.js';
import type { Orb, RechargeTap } from '../recharge.js';
import type { Rng } from '../rng.js';
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

  const position = gauge.center + delta <= 1 ? gauge.center + delta : gauge.center - delta;
  const tapAtMs = (Math.max(0, position) * gauge.periodMs) / 2;
  return Math.min(tapAtMs, config.timing.maxChargeMs);
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
}

const TIERS: readonly Tier[] = [0, 1, 2, 3, 4];

/** Le style qui bat celui passe en parametre. */
function beaterOf(style: Style, config: BalanceConfig): Style {
  return config.styles.find((candidate) => config.styleBeats[candidate] === style) ?? style;
}

const alreadyPlayed = (move: Move, previousMoves: readonly Move[]): boolean =>
  previousMoves.some((played) => played.style === move.style && played.tier === move.tier);

export function decideChoice(context: AiChoiceContext, config: BalanceConfig = BALANCE): Choice {
  const { profile, rng, energy, previousMoves, opponentStyles } = context;

  const lastOpponentStyle = opponentStyles.at(-1);
  const style: Style =
    lastOpponentStyle !== undefined && rng.chance(profile.read)
      ? beaterOf(lastOpponentStyle, config)
      : rng.pick(config.styles);

  // Budget de la manche : une IA agressive brule son energie tot, une prudente
  // la garde pour la belle.
  const budget = Math.min(energy, Math.round(config.maxRoundCost * profile.aggression));
  const spend = budget <= 0 ? 0 : rng.nextInt(Math.ceil(budget / 2), budget);
  const desiredTier = Math.min(TIERS.length - 1, spend) as Tier;

  const affordableTier = (candidate: Tier): boolean => config.tierCost[candidate] <= spend;
  const fresh = (candidateStyle: Style, candidateTier: Tier): boolean =>
    !alreadyPlayed({ style: candidateStyle, tier: candidateTier }, previousMoves);

  // Rejouer le meme mouvement coute 30 % du score : on decale d'abord le palier,
  // puis le style, et on ne se repete qu'une fois toutes les options epuisees.
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

  const amplifier = Math.min(4, Math.max(0, spend - config.tierCost[move.tier])) as AmplifierLevel;

  return {
    move,
    amplifier,
    useUltimate: profile.usesUltimate && context.ultimateGauge >= config.ultimate.gaugeMax,
  };
}
