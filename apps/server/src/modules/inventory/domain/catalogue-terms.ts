/**
 * Rarete et prix d'une couleur ou d'une tenue.
 *
 * Un EXCLUSIF de saison n'a aucun prix (ni pieces ni jetons : `NOT_PURCHASABLE`)
 * et une rarete legendaire : un prix de 0 et la rarete par defaut le feraient
 * tenir pour offert a TOUS (`isOffered`), et il se gagne sur le passe.
 */
export function catalogueTerms(item: { readonly price: number; readonly exclusive?: string }): {
  rarity: string;
  priceSoft: number | null;
} {
  if (item.exclusive !== undefined) return { rarity: 'legendary', priceSoft: null };
  return { rarity: item.price === 0 ? 'default' : 'common', priceSoft: item.price };
}
