import {
  OWNED_ITEM_MIN_COINS,
  ownedItemCoins,
  SEASON_PASS,
  seasonTierFor,
  type SeasonPass,
  type SeasonReward,
  type SeasonTrack,
} from '@aura/content';
import {
  ownedWithFree,
  type CatalogueEntry,
  type Wallet,
} from '../../inventory/domain/purchase.js';

/**
 * La regle du passe de saison, en fonctions pures (docs/01, passe de saison).
 *
 * Elle ne connait ni base ni transaction : on lui donne l'XP, la piste, ce qui
 * est reclame et ce qui est possede, elle dit ce qu'une reclamation rapporte.
 * L'adaptateur applique. Le client ne propose qu'un palier et une piste,
 * jamais un montant (regle d'or n°1).
 *
 * Le passe est un PARAMETRE, par defaut celui du contenu : les tests lisent un
 * passe de quatre paliers au lieu de trente.
 */

/**
 * Le moins que vaut un cosmetique deja possede, en pieces.
 *
 * Un objet offert a tous (prix nul) est possede par tout le monde : a son prix
 * du catalogue, il ne rapporterait rien. Le plancher vaut une recompense de
 * pieces ordinaire de la piste gratuite — une recompense n'est jamais vide.
 */

export interface ClaimKey {
  readonly tier: number;
  readonly track: SeasonTrack;
}

/** Ce qu'une reclamation accorde, pret a ecrire. */
export interface SeasonGrant extends ClaimKey {
  readonly coins: number;
  readonly tokens: number;
  /** Le cosmetique accorde ; `null` s'il se change en pieces ou s'il n'y en a pas. */
  readonly itemId: string | null;
  /**
   * Les pieces a donner a la place de `itemId` si la base le trouve deja
   * possede a l'ecriture — un achat passe entre la lecture et l'ecriture. Zero
   * sans objet.
   */
  readonly fallbackCoins: number;
}

export type ClaimRefusal = 'TIER_LOCKED' | 'PREMIUM_REQUIRED' | 'ALREADY_CLAIMED' | 'UNKNOWN_TIER';

export type ClaimOutcome =
  | { readonly ok: true; readonly grant: SeasonGrant }
  | { readonly ok: false; readonly reason: ClaimRefusal };

export interface ClaimContext {
  /** L'XP de saison, lue en base. */
  readonly xp: number;
  readonly premium: boolean;
  readonly claimed: readonly ClaimKey[];
  /** Ce que possede le joueur. Les objets offerts a tous s'y ajoutent ici. */
  readonly owned: readonly string[];
  readonly catalogue: readonly CatalogueEntry[];
  readonly pass?: SeasonPass;
}

const TRACKS: readonly SeasonTrack[] = ['free', 'premium'];

/**
 * La valeur en pieces d'un cosmetique, s'il se change en pieces.
 *
 * Au prix le plus bas auquel la boutique le vend (la vitrine, -30 %), jamais
 * au prix plein : sinon l'acheter en vitrine puis le reclamer ici rendait plus
 * qu'il n'avait coute, et creait des pieces a chaque saison.
 */
function coinsFor(itemId: string, catalogue: readonly CatalogueEntry[]): number {
  return ownedItemCoins(catalogue.find((item) => item.id === itemId)?.priceSoft ?? 0);
}

function grantFor(
  key: ClaimKey,
  reward: SeasonReward,
  owned: ReadonlySet<string>,
  catalogue: readonly CatalogueEntry[],
): SeasonGrant {
  const none = { ...key, coins: 0, tokens: 0, itemId: null, fallbackCoins: 0 };
  if (reward.kind === 'coins') return { ...none, coins: reward.amount };
  if (reward.kind === 'tokens') return { ...none, tokens: reward.amount };

  const coins = coinsFor(reward.itemId, catalogue);
  /*
    Absent du catalogue : la cle etrangere de `InventoryItem` refuserait
    l'ecriture, et la reclamation tomberait en panne a chaque essai. Il se
    change en pieces, comme un objet deja possede.
  */
  const known = catalogue.some((item) => item.id === reward.itemId);
  if (!known || owned.has(reward.itemId)) return { ...none, coins };
  return { ...none, itemId: reward.itemId, fallbackCoins: coins };
}

/**
 * Ce que rapporte la reclamation d'un palier sur une piste.
 *
 * L'ordre des refus compte. « Palier non atteint » passe avant « premium
 * requis » : pousser a acheter la piste pour un palier qu'elle ne donnerait
 * pas encore serait vendre une attente.
 */
export function claimOutcome(key: ClaimKey, context: ClaimContext): ClaimOutcome {
  const pass = context.pass ?? SEASON_PASS;
  const tier = pass.tiers.find((candidate) => candidate.tier === key.tier);
  if (tier === undefined || !TRACKS.includes(key.track)) {
    return { ok: false, reason: 'UNKNOWN_TIER' };
  }
  if (context.claimed.some((c) => c.tier === key.tier && c.track === key.track)) {
    return { ok: false, reason: 'ALREADY_CLAIMED' };
  }
  if (tierFor(context.xp, pass) < key.tier) return { ok: false, reason: 'TIER_LOCKED' };
  if (key.track === 'premium' && !context.premium) {
    return { ok: false, reason: 'PREMIUM_REQUIRED' };
  }

  const reward = key.track === 'free' ? tier.free : tier.premium;
  const owned = new Set(ownedWithFree(context.owned, context.catalogue));
  return { ok: true, grant: grantFor(key, reward, owned, context.catalogue) };
}

/**
 * « Tout recuperer » : chaque recompense atteinte et pas encore reclamee, sur
 * les pistes du joueur, palier par palier.
 *
 * Un objet accorde plus tot dans le lot compte comme possede pour la suite :
 * le meme cosmetique sur deux pistes ne s'ecrirait pas deux fois.
 */
export function claimAll(context: ClaimContext): readonly SeasonGrant[] {
  const pass = context.pass ?? SEASON_PASS;
  const owned = new Set(context.owned);
  const grants: SeasonGrant[] = [];
  for (const tier of pass.tiers) {
    for (const track of TRACKS) {
      const outcome = claimOutcome({ tier: tier.tier, track }, { ...context, owned: [...owned] });
      if (!outcome.ok) continue;
      grants.push(outcome.grant);
      if (outcome.grant.itemId !== null) owned.add(outcome.grant.itemId);
    }
  }
  return grants;
}

/**
 * Le dernier palier atteint.
 *
 * `seasonTierFor` pour le vrai passe ; recalcule pour un autre passe, afin que
 * les tests d'un passe reduit ne lisent pas les trente paliers du contenu.
 */
function tierFor(xp: number, pass: SeasonPass): number {
  if (pass === SEASON_PASS) return seasonTierFor(xp);
  if (!Number.isFinite(xp) || xp <= 0) return 0;
  return Math.min(pass.tiers.length, Math.floor(xp / pass.xpPerTier));
}

export type PremiumRefusal = 'ALREADY_PREMIUM' | 'INSUFFICIENT_FUNDS';

export type PremiumOutcome =
  | { readonly ok: true; readonly spend: Wallet }
  | { readonly ok: false; readonly reason: PremiumRefusal };

/**
 * L'achat de la piste premium : des jetons, jamais des pieces ni de l'argent
 * directement (docs/01). « Deja premium » passe avant les fonds : on ne dit pas
 * a quelqu'un qu'il lui manque de quoi payer ce qu'il a deja.
 */
export function premiumOutcome(
  request: { readonly wallet: Wallet; readonly premium: boolean },
  pass: SeasonPass = SEASON_PASS,
): PremiumOutcome {
  if (request.premium) return { ok: false, reason: 'ALREADY_PREMIUM' };
  if (request.wallet.hard < pass.premiumPrice) return { ok: false, reason: 'INSUFFICIENT_FUNDS' };
  return { ok: true, spend: { soft: 0, hard: pass.premiumPrice } };
}

/** Reexporte : la regle de conversion vit dans `@aura/content`, lue aussi par l'ecran. */
export { OWNED_ITEM_MIN_COINS };
