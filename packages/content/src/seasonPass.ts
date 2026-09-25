import { discountedPrice } from './featured.js';
/**
 * Le passe de saison (chantier n°6), en donnee (regle d'or n°5).
 *
 * Lu par le serveur, qui seul juge et accorde, et par le client, qui montre
 * la piste. Trente paliers de cent XP de saison. La piste premium se paie en
 * jetons (500) et en rend 200 sur la saison : jamais de puissance, seulement
 * des pieces, des jetons et des cosmetiques (regle d'or n°3).
 *
 * Un cosmetique deja possede se change en pieces, a son prix du catalogue —
 * c'est le serveur qui le decide au moment de la reclamation.
 */

export type SeasonReward =
  | { readonly kind: 'coins'; readonly amount: number }
  | { readonly kind: 'tokens'; readonly amount: number }
  | { readonly kind: 'item'; readonly itemId: string };

export type SeasonTrack = 'free' | 'premium';

export interface SeasonTier {
  readonly tier: number;
  readonly free: SeasonReward;
  readonly premium: SeasonReward;
}

export interface SeasonPass {
  readonly xpPerTier: number;
  /** Prix de la piste premium, en jetons. */
  readonly premiumPrice: number;
  readonly tiers: readonly SeasonTier[];
}

const TIER_COUNT = 30;
const XP_PER_TIER = 100;

/** Les cosmetiques de la piste gratuite : un tous les dix paliers. */
const FREE_ITEMS: Readonly<Record<number, string>> = {
  10: 'color.violet',
  20: 'hair.pics',
  30: 'fx.flames',
};

/** Jetons de la piste gratuite. */
const FREE_TOKENS: Readonly<Record<number, number>> = { 5: 5, 15: 5, 25: 5 };

/**
 * Les cosmetiques de la piste premium. Le palier 1 en porte un : acheter le
 * passe donne quelque chose sur-le-champ.
 */
const PREMIUM_ITEMS: Readonly<Record<number, string>> = {
  1: 'anim.acrobatie.t2.splitleap',
  5: 'color.white',
  10: 'outfit.costume',
  14: 'hair.long',
  20: 'anim.prouesse.t4.lsit',
  25: 'fx.shock',
  28: 'anim.acrobatie.t4.frontflip',
  29: 'fx.dark',
};

function freeReward(tier: number): SeasonReward {
  const item = FREE_ITEMS[tier];
  if (item !== undefined) return { kind: 'item', itemId: item };
  const tokens = FREE_TOKENS[tier];
  if (tokens !== undefined) return { kind: 'tokens', amount: tokens };
  return { kind: 'coins', amount: 40 };
}

function premiumReward(tier: number): SeasonReward {
  const item = PREMIUM_ITEMS[tier];
  if (item !== undefined) return { kind: 'item', itemId: item };
  // Vingt jetons tous les trois paliers : 200 sur la saison.
  if (tier % 3 === 0) return { kind: 'tokens', amount: 20 };
  return { kind: 'coins', amount: 60 };
}

export const SEASON_PASS: SeasonPass = Object.freeze({
  xpPerTier: XP_PER_TIER,
  premiumPrice: 500,
  tiers: Object.freeze(
    Array.from({ length: TIER_COUNT }, (_, i) =>
      Object.freeze({ tier: i + 1, free: freeReward(i + 1), premium: premiumReward(i + 1) }),
    ),
  ),
});

/** Le dernier palier atteint avec `xp` d'experience de saison (0 : aucun). */
export function seasonTierFor(xp: number): number {
  if (!Number.isFinite(xp) || xp <= 0) return 0;
  return Math.min(TIER_COUNT, Math.floor(xp / XP_PER_TIER));
}

/** Ce qu'un cosmetique deja possede rapporte au minimum : une case de pieces. */
export const OWNED_ITEM_MIN_COINS = 40;

/**
 * Ce que rapporte un cosmetique du passe que le joueur possede deja.
 *
 * Au prix le plus bas auquel la boutique le vend (la vitrine, -30 %) : sinon
 * l'acheter en vitrine puis le reclamer rendait plus qu'il n'avait coute. Et
 * jamais moins qu'une case de pieces : une recompense n'est jamais vide.
 * Lue par le serveur qui paie et par l'ecran qui l'annonce.
 */
export function ownedItemCoins(priceSoft: number): number {
  return Math.max(discountedPrice(priceSoft), OWNED_ITEM_MIN_COINS);
}
