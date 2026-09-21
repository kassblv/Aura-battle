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
}

function purchasable(kind: CosmeticKind): boolean {
  return (PURCHASABLE_KINDS as readonly CosmeticKind[]).includes(kind);
}

export function purchaseOutcome(request: PurchaseRequest): PurchaseOutcome {
  const { item, wallet, owned, now } = request;

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
  if (item.priceSoft !== null && wallet.soft >= item.priceSoft) {
    return { ok: true, spend: { soft: item.priceSoft, hard: 0 } };
  }
  if (item.priceHard !== null && wallet.hard >= item.priceHard) {
    return { ok: true, spend: { soft: 0, hard: item.priceHard } };
  }

  return { ok: false, reason: 'INSUFFICIENT_FUNDS' };
}
