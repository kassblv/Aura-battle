import { TOKEN_PACKS } from '@aura/content';

/** Un pack de jetons tel que la boutique le montre. */
export interface TokenOffer {
  readonly productId: string;
  /** Ce que le serveur creditera : la quantite vient de `TOKEN_PACKS`. */
  readonly tokens: number;
  /** Le prix du store, deja localise (monnaie, taxes). */
  readonly price: string;
}

/** Ce que le store rend d'un produit : son identifiant et son prix affiche. */
export interface StoreProduct {
  readonly identifier: string;
  readonly priceString: string;
}

/**
 * Les packs a afficher : ceux du catalogue que le store sait facturer, dans
 * l'ordre du catalogue. La quantite vient de chez nous, le prix du store —
 * c'est lui qui encaisse, et il connait la monnaie et les taxes du joueur.
 */
export function tokenOffers(products: readonly StoreProduct[]): readonly TokenOffer[] {
  return TOKEN_PACKS.flatMap((pack) => {
    const product = products.find((p) => p.identifier === pack.productId);
    return product === undefined
      ? []
      : [{ productId: pack.productId, tokens: pack.tokens, price: product.priceString }];
  });
}

/**
 * Ce que la boutique dit d'un achat de jetons en cours.
 *
 * - `pending` : le store a encaisse, le serveur n'a pas encore credite ;
 * - `credited` : la bourse a monte de `tokens` ;
 * - `failed` : le store a refuse (pas une annulation du joueur).
 */
export type PurchaseNotice =
  | { readonly kind: 'pending'; readonly before: number }
  | { readonly kind: 'credited'; readonly tokens: number }
  | { readonly kind: 'failed' }
  | null;

/** Le message une fois la bourse relue : l'attente cesse quand les jetons arrivent. */
export function noticeAfterWallet(notice: PurchaseNotice, hard: number): PurchaseNotice {
  if (notice?.kind !== 'pending' || hard <= notice.before) return notice;
  return { kind: 'credited', tokens: hard - notice.before };
}
