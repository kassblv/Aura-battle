import { discountedPrice, isFeatured } from '@aura/content';
import type { CosmeticKind } from '@prisma/client';

/**
 * La regle d'achat, en fonction pure.
 *
 * Elle ne connait ni base ni transaction : on lui donne l'objet, la bourse et
 * l'heure, elle dit oui ou non et ce que ca coute. L'adaptateur applique.
 * C'est ce qui permet de verifier « on ne vend que de l'apparence » sans
 * ouvrir une base.
 */

/**
 * Ce que la boutique a le droit de vendre.
 *
 * **Regle d'or n°3, et c'est ici qu'elle se tient** : tout ce qui modifie un
 * score est accessible a tous. Cette liste est une GARDE, pas une intention —
 * un `CosmeticKind` ajoute demain n'est pas vendable tant que personne ne l'a
 * ecrit ici, et un test se casse si quelqu'un l'elargit sans y penser.
 */
export const PURCHASABLE_KINDS = [
  'ANIMATION',
  'AURA_COLOR',
  'AURA_EFFECT',
  'BANNER',
  'HAIR',
  'OUTFIT',
] as const satisfies readonly CosmeticKind[];

export interface CatalogueEntry {
  readonly id: string;
  readonly kind: CosmeticKind;
  /** `default` pour ce qui est offert a tous (`isOffered`), sinon la rarete vendue. */
  readonly rarity: string;
  /** `null` ne veut pas dire gratuit : il veut dire **pas a vendre**. */
  readonly priceSoft: number | null;
  readonly priceHard: number | null;
  readonly availableFrom: Date | null;
  readonly availableTo: Date | null;
}

export interface Wallet {
  readonly soft: number;
  readonly hard: number;
}

export type PurchaseRefusal =
  'ALREADY_OWNED' | 'NOT_PURCHASABLE' | 'UNAVAILABLE' | 'INSUFFICIENT_FUNDS';

export type PurchaseOutcome =
  | { readonly ok: true; readonly spend: Wallet }
  | { readonly ok: false; readonly reason: PurchaseRefusal };

export interface PurchaseRequest {
  readonly item: CatalogueEntry;
  readonly wallet: Wallet;
  readonly owned: boolean;
  readonly now: Date;
  /**
   * Le numero du jour, pour la vitrine (`docs/01` §11).
   *
   * Un PARAMETRE, pas une lecture d'horloge : la regle reste pure, et le jour
   * vient du serveur. Absent, c'est le prix plein — le defaut doit etre celui
   * qui ne donne rien, jamais celui qui offre une remise a tout le monde.
   */
  readonly day?: number;
  /**
   * La monnaie choisie par le joueur (protocole 2.2.0).
   *
   * Choisie, elle est la SEULE prelevee : pas de repli silencieux sur l'autre,
   * qui viderait la poche que le joueur voulait garder. Absente, les pieces
   * d'abord, les jetons si elles manquent (comportement 2.1).
   */
  readonly currency?: 'soft' | 'hard';
}

/**
 * Le prix reellement facture pour cet article aujourd'hui.
 *
 * La remise se calcule ICI, avec le prix du catalogue. Le client ne l'envoie
 * pas et ne pourrait pas : il annoncerait « cet article est en vitrine » et
 * acheterait tout a moins trente pour cent. Regle d'or n°1.
 */
function effectiveSoft(item: CatalogueEntry, day: number | undefined): number | null {
  if (item.priceSoft === null) return null;
  if (day === undefined || !isFeatured(item.id, day)) return item.priceSoft;
  return discountedPrice(item.priceSoft);
}

/** Le prix en jetons facture aujourd'hui : la vitrine remise aussi les jetons. */
function effectiveHard(item: CatalogueEntry, day: number | undefined): number | null {
  if (item.priceHard === null) return null;
  if (day === undefined || !isFeatured(item.id, day)) return item.priceHard;
  return discountedPrice(item.priceHard);
}

function purchasable(kind: CosmeticKind): boolean {
  return (PURCHASABLE_KINDS as readonly CosmeticKind[]).includes(kind);
}

export function purchaseOutcome(request: PurchaseRequest): PurchaseOutcome {
  const { item, wallet, owned, now } = request;
  const soft = effectiveSoft(item, request.day);

  /*
    L'ordre des refus compte.

    « Tu possedes deja ca » passe avant « tu n'as pas assez » : quelqu'un qui
    possede l'objet ET n'a pas d'argent doit lire le premier, sinon il va
    gagner de quoi racheter ce qu'il a deja.
  */
  if (owned) return { ok: false, reason: 'ALREADY_OWNED' };
  if (!purchasable(item.kind)) return { ok: false, reason: 'NOT_PURCHASABLE' };

  // Un `null` traite comme un zero offrirait le catalogue entier a qui trouve
  // la ligne ou le prix a ete oublie.
  if (item.priceSoft === null && item.priceHard === null) {
    return { ok: false, reason: 'NOT_PURCHASABLE' };
  }

  if (item.availableFrom !== null && now < item.availableFrom) {
    return { ok: false, reason: 'UNAVAILABLE' };
  }
  if (item.availableTo !== null && now > item.availableTo) {
    return { ok: false, reason: 'UNAVAILABLE' };
  }

  /*
    La monnaie douce d'abord.

    Quelqu'un qui a gagne de quoi se payer un objet en jouant ne doit pas se
    voir prelever la monnaie qu'il a achetee — c'est la seule des deux qu'il ne
    peut pas regagner.
  */
  /*
    Les fonds se jugent sur le prix REELLEMENT facture.

    Juger sur le prix plein puis debiter le prix remise refuserait un achat que
    le joueur peut s'offrir ; l'inverse le laisserait passer a decouvert. Une
    seule valeur pour les deux, et la question ne se pose plus.
  */
  const hard = effectiveHard(item, request.day);

  if (request.currency === 'soft' || request.currency === 'hard') {
    const price = request.currency === 'soft' ? soft : hard;
    if (price === null) return { ok: false, reason: 'NOT_PURCHASABLE' };
    if (wallet[request.currency] < price) return { ok: false, reason: 'INSUFFICIENT_FUNDS' };
    return {
      ok: true,
      spend: request.currency === 'soft' ? { soft: price, hard: 0 } : { soft: 0, hard: price },
    };
  }

  if (soft !== null && wallet.soft >= soft) {
    return { ok: true, spend: { soft, hard: 0 } };
  }
  if (hard !== null && wallet.hard >= hard) {
    return { ok: true, spend: { soft: 0, hard } };
  }

  return { ok: false, reason: 'INSUFFICIENT_FUNDS' };
}

/**
 * Un objet offert a tout le monde, sans achat.
 *
 * **Toutes les conditions, pas seulement le prix.** La regle ne regardait que
 * `priceSoft === 0` et contredisait `purchaseOutcome` : un objet d'evenement a
 * zero piece mais borne a une semaine, ou vendu en monnaie forte, etait refuse
 * a l'achat et pourtant possede par tous, pour toujours.
 *
 * La rarete `default` est le critere EXPLICITE — celle que le contenu reserve
 * a ce qu'il offre (un test de `@aura/content` refuse un prix de zero sous
 * toute autre rarete). Le prix nul, l'absence de prix fort et de fenetre, et
 * un kind vendable sont exiges en plus : un seul champ mal saisi au catalogue
 * ne doit jamais suffire a tout donner.
 */
export function isOffered(item: CatalogueEntry): boolean {
  return (
    item.rarity === 'default' &&
    item.priceSoft === 0 &&
    item.priceHard === null &&
    item.availableFrom === null &&
    item.availableTo === null &&
    purchasable(item.kind)
  );
}

/**
 * Ce que possede un joueur, les objets offerts compris.
 *
 * **Ce qui est offert (`isOffered`) appartient a tout le monde**, et n'est
 * jamais ecrit en base. Deux lecteurs en ont besoin — l'inventaire et le
 * match — et le match l'avait oublie : il tenait pour non possedes la tenue,
 * les couleurs et les danses offertes, et les retirait de l'apparence
 * annoncee a l'adversaire.
 */
export function ownedWithFree(
  stored: readonly string[],
  catalogue: readonly CatalogueEntry[],
): readonly string[] {
  const owned = new Set(stored);
  for (const item of catalogue) {
    if (isOffered(item)) owned.add(item.id);
  }
  return [...owned];
}
