/**
 * Les packs de jetons vendus contre de l'argent reel (ADR 0016).
 *
 * Seule la QUANTITE vit ici : le prix en euros est celui des consoles de l'App
 * Store et de Google Play, affiche tel que RevenueCat le rend (monnaie et
 * taxes locales). Le serveur credite d'apres ce tableau, jamais d'apres ce
 * qu'annoncerait le client — regle d'or n°1.
 *
 * Les identifiants de produit doivent etre crees a l'identique dans les deux
 * stores et rattaches a RevenueCat.
 */
export interface TokenPack {
  /** Identifiant du produit consommable dans les stores. */
  readonly productId: string;
  readonly tokens: number;
}

export const TOKEN_PACKS: readonly TokenPack[] = Object.freeze([
  { productId: 'aura.tokens.100', tokens: 100 },
  { productId: 'aura.tokens.550', tokens: 550 },
  { productId: 'aura.tokens.1200', tokens: 1_200 },
]);

export function tokenPackFor(productId: string): TokenPack | undefined {
  return TOKEN_PACKS.find((pack) => pack.productId === productId);
}
