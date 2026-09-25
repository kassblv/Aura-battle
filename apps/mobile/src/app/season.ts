import {
  ownedItemCoins,
  SEASON_PASS,
  type SeasonPass,
  type SeasonReward,
  type SeasonTrack,
} from '@aura/content';
import type { SeasonState } from '@aura/protocol';
import type { RewardSize } from '../audio/cues.js';
import { itemInfo } from './wardrobe.js';

/**
 * Le passe de saison, mis en forme pour l'ecran.
 *
 * Rien ici ne JUGE : le palier atteint, la piste premium et ce qui a deja ete
 * reclame viennent tous de la reponse du serveur (`SeasonState`). Ce module
 * les croise avec le CONTENU (`SEASON_PASS`) pour dire, case par case, ce que
 * le joueur voit. Un bouton « reclamer » qu'il allumerait a tort se heurterait
 * a un refus, jamais a un gain.
 */

/**
 * L'etat d'une case.
 *
 * - `claimed` : deja encaissee ;
 * - `claimable` : atteinte, sur une piste ouverte, pas encore prise ;
 * - `sealed` : atteinte, mais la piste premium n'est pas achetee — c'est ce
 *   qui rend l'achat tentant, donc on la distingue d'une case lointaine ;
 * - `ahead` : pas encore atteinte.
 */
export type SeasonCellState = 'claimed' | 'claimable' | 'sealed' | 'ahead';

export interface SeasonCell {
  readonly tier: number;
  readonly track: SeasonTrack;
  readonly state: SeasonCellState;
  readonly kind: SeasonReward['kind'];
  /** Pictogramme de la recompense. */
  readonly icon: string;
  /** Ce qui s'ecrit sous le pictogramme : un montant, ou le nom de l'objet. */
  readonly label: string;
  /** Le cosmetique a essayer sur le personnage, ou `null`. */
  readonly itemId: string | null;
  /**
   * Cosmetique deja possede : le serveur le changera en pieces, a son prix du
   * catalogue. On l'annonce pour que la case ne promette pas un objet en
   * double.
   */
  readonly converts: boolean;
  /** La ligne qui s'envole a l'encaissement : « +40 ◈ », « +5 💎 », « Violet ». */
  readonly gain: string;
}

export interface SeasonTierView {
  readonly tier: number;
  readonly reached: boolean;
  /** Le palier en cours de remplissage : le prochain a atteindre. */
  readonly next: boolean;
  readonly free: SeasonCell;
  readonly premium: SeasonCell;
}

export interface SeasonView {
  readonly number: number;
  readonly daysLeft: number;
  readonly tier: number;
  readonly lastTier: number;
  /** XP gagnee dans le palier en cours, et ce qu'il en demande. */
  readonly xpInto: number;
  readonly xpNeeded: number;
  /** Part remplie du palier en cours, bornee a [0, 1]. */
  readonly progress: number;
  /** Tous les paliers atteints : il n'y a plus de barre a remplir. */
  readonly maxed: boolean;
  readonly premium: boolean;
  readonly premiumPrice: number;
  /** Jetons qui manquent pour la piste premium ; 0 si elle est abordable. */
  readonly premiumShortfall: number;
  /** Cases a encaisser : la pastille du rail et « Tout recuperer (N) ». */
  readonly claimable: number;
  /** Recompenses premium deja atteintes, en attente de l'achat. */
  readonly sealed: number;
  readonly tiers: readonly SeasonTierView[];
  /** Le palier a centrer a l'ouverture : la premiere case a prendre, sinon le prochain. */
  readonly focus: number;
}

const DAY_MS = 86_400_000;

/**
 * Jours restants, arrondis au-dessus : « 1 jour » tant que la saison n'est pas
 * finie, jamais « 0 jour » avec des heures devant soi.
 */
export function daysLeft(endsAt: string, now: number): number {
  const end = Date.parse(endsAt);
  if (!Number.isFinite(end) || !Number.isFinite(now)) return 0;
  return Math.max(0, Math.ceil((end - now) / DAY_MS));
}

/** Le pictogramme d'un cosmetique, d'apres son rayon. */
function itemIcon(itemId: string): string {
  if (itemId.startsWith('color.')) return '🎨';
  if (itemId.startsWith('hair.')) return '💇';
  if (itemId.startsWith('outfit.')) return '👕';
  if (itemId.startsWith('fx.')) return '✨';
  if (itemId.startsWith('anim.')) return '💃';
  return '🎁';
}

/** Pictogramme, libelle et ligne de gain d'une recompense. */
export function describeReward(
  reward: SeasonReward,
  owned: ReadonlySet<string> = new Set(),
): Pick<SeasonCell, 'kind' | 'icon' | 'label' | 'itemId' | 'converts' | 'gain'> {
  switch (reward.kind) {
    case 'coins':
      return {
        kind: 'coins',
        icon: '◈',
        label: String(reward.amount),
        itemId: null,
        converts: false,
        gain: `+${String(reward.amount)} ◈`,
      };
    case 'tokens':
      return {
        kind: 'tokens',
        icon: '💎',
        label: String(reward.amount),
        itemId: null,
        converts: false,
        gain: `+${String(reward.amount)} 💎`,
      };
    case 'item': {
      const info = itemInfo(reward.itemId);
      const name = info?.name ?? 'Cosmétique';
      // Meme regle que le serveur qui paie (`ownedItemCoins`) : prix de
      // vitrine, et jamais moins qu'une case de pieces.
      const converts = owned.has(reward.itemId) && info !== null;
      return {
        kind: 'item',
        icon: itemIcon(reward.itemId),
        label: name,
        itemId: reward.itemId,
        converts,
        gain: converts ? `+${String(ownedItemCoins(info.price))} ◈` : name,
      };
    }
  }
}

const NOTHING_OWNED: ReadonlySet<string> = new Set();

const key = (tier: number, track: SeasonTrack): string => `${String(tier)}:${track}`;

/**
 * La vue complete du passe, ou `null` quand aucune saison n'est en cours.
 *
 * `owned` (l'inventaire) ne sert qu'a annoncer la conversion en pieces d'un
 * cosmetique deja possede ; `now` est passe plutot que lu, pour que le compte
 * des jours se teste.
 */
export function seasonView(
  state: SeasonState,
  now: number,
  owned: ReadonlySet<string> = new Set(),
  pass: SeasonPass = SEASON_PASS,
): SeasonView | null {
  if (state.season === null) return null;

  const lastTier = pass.tiers.length;
  const tier = Math.min(Math.max(0, state.tier), lastTier);
  const claimed = new Set(state.claimed.map((entry) => key(entry.tier, entry.track)));

  const cell = (tierNumber: number, track: SeasonTrack, reward: SeasonReward): SeasonCell => {
    const reached = tierNumber <= tier;
    const open = track === 'free' || state.premium;
    const status: SeasonCellState = claimed.has(key(tierNumber, track))
      ? 'claimed'
      : !reached
        ? 'ahead'
        : open
          ? 'claimable'
          : 'sealed';
    // Une case reclamee reste ce qu'elle a donne : l'objet est desormais a
    // soi PARCE QU'elle l'a donne, pas avant.
    const ownedBefore = status === 'claimed' ? NOTHING_OWNED : owned;
    return { tier: tierNumber, track, state: status, ...describeReward(reward, ownedBefore) };
  };

  const tiers = pass.tiers.map((entry) => ({
    tier: entry.tier,
    reached: entry.tier <= tier,
    next: entry.tier === tier + 1,
    free: cell(entry.tier, 'free', entry.free),
    premium: cell(entry.tier, 'premium', entry.premium),
  }));

  const cells = tiers.flatMap((entry) => [entry.free, entry.premium]);
  const claimable = cells.filter((entry) => entry.state === 'claimable').length;
  const sealed = cells.filter((entry) => entry.state === 'sealed').length;

  const maxed = tier >= lastTier;
  // L'XP au-dela du palier courant, jamais negative ni superieure au palier :
  // une barre a 140 % se lit comme un bogue.
  const xpInto = maxed
    ? pass.xpPerTier
    : Math.min(pass.xpPerTier, Math.max(0, state.xp - tier * pass.xpPerTier));

  const firstClaimable = tiers.find(
    (entry) => entry.free.state === 'claimable' || entry.premium.state === 'claimable',
  );

  return {
    number: state.season.number,
    daysLeft: daysLeft(state.season.endsAt, now),
    tier,
    lastTier,
    xpInto,
    xpNeeded: pass.xpPerTier,
    progress: pass.xpPerTier > 0 ? xpInto / pass.xpPerTier : 0,
    maxed,
    premium: state.premium,
    premiumPrice: pass.premiumPrice,
    premiumShortfall: state.premium ? 0 : Math.max(0, pass.premiumPrice - state.wallet.hard),
    claimable,
    sealed,
    tiers,
    focus: firstClaimable?.tier ?? Math.min(lastTier, tier + 1),
  };
}

/** Cases a encaisser, pour la pastille du rail — 0 sans saison. */
export function claimableCount(state: SeasonState | null): number {
  if (state === null) return 0;
  return seasonView(state, 0)?.claimable ?? 0;
}

export interface ClaimedCell {
  readonly tier: number;
  readonly track: SeasonTrack;
}

/**
 * Ce qui vient d'etre encaisse, par difference entre deux reponses.
 *
 * C'est la reponse du serveur qui fait foi : on anime ce qu'il a ACCORDE, pas
 * ce que le joueur a touche.
 */
export function newlyClaimed(
  before: SeasonState | null,
  after: SeasonState,
): readonly ClaimedCell[] {
  const known = new Set(before?.claimed.map((entry) => key(entry.tier, entry.track)) ?? []);
  return after.claimed
    .filter((entry) => !known.has(key(entry.tier, entry.track)))
    .map((entry) => ({ tier: entry.tier, track: entry.track }));
}

/**
 * Le palier atteint depuis la derniere lecture, ou `null`.
 *
 * Seulement entre deux lectures de la MEME saison : un changement de saison
 * remet l'XP a zero, et ce n'est pas une montee.
 */
export function tierReached(before: SeasonState | null, after: SeasonState): number | null {
  const was = before?.season ?? null;
  if (before === null || was === null || after.season === null) return null;
  if (was.number !== after.season.number) return null;
  return after.tier > before.tier ? after.tier : null;
}

/** « Palier N atteint », rattache au match qui l'a fait atteindre. */
export interface TierAnnouncement {
  readonly tier: number;
  /** Le compteur de matchs (`record.matches`) de la lecture qui l'a trouve. */
  readonly forMatch: number;
}

/**
 * L'annonce qu'une lecture produit, ou `null`.
 *
 * Seule la lecture qui SUIT une fin de match annonce : celle qui suit
 * l'ouverture de l'ecran trouverait peut-etre un palier atteint plus tot, et
 * l'annoncerait a la fin d'un match qui n'y est pour rien.
 */
export function announcementAfterRead(
  before: SeasonState | null,
  after: SeasonState,
  read: { readonly matchRead: boolean; readonly match: number },
): TierAnnouncement | null {
  if (!read.matchRead) return null;
  const tier = tierReached(before, after);
  return tier === null ? null : { tier, forMatch: read.match };
}

/** Le palier a annoncer a l'ecran de fin de CE match, ou `null`. */
export function visibleAnnouncement(
  announcement: TierAnnouncement | null,
  match: number,
): number | null {
  return announcement !== null && announcement.forMatch === match ? announcement.tier : null;
}

/**
 * Le poids sonore d'un encaissement.
 *
 * Le gros lot quand plusieurs recompenses tombent d'un coup ou que la piste
 * premium s'ouvre ; « rare » pour des jetons ou un cosmetique ; des pieces
 * sinon.
 */
export function rewardSize(
  cells: readonly ClaimedCell[],
  premiumUnlocked: boolean,
  pass: SeasonPass = SEASON_PASS,
): RewardSize {
  if (premiumUnlocked || cells.length > 1) return 'jackpot';
  const cell = cells[0];
  const reward = cell === undefined ? undefined : pass.tiers[cell.tier - 1]?.[cell.track];
  return reward === undefined || reward.kind === 'coins' ? 'small' : 'rare';
}
