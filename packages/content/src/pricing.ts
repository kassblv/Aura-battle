import { AURA_EFFECTS, EMOTES, type Rarity } from './cosmetics.js';

/**
 * Le bareme : une rarete, un prix.
 *
 * Il existe parce que le catalogue en etait depourvu et que les prix avaient
 * ete poses un a un. On s'y etait retrouve avec une emote **legendaire a 900**
 * a cote d'un effet **epique a 1 250** — c'est-a-dire un mot qui promet plus
 * cher et tient moins. Un joueur qui remarque ca cesse de croire la boutique
 * entiere, pas seulement ces deux lignes.
 *
 * Aucun de ces prix ne touche a l'equilibrage : la regle d'or n°3 tient, tout
 * ce qui modifie un score reste accessible a tous. Deux animations d'un meme
 * mouvement sont strictement equivalentes — on ne vend que le geste.
 */

/** De l'offert au plus rare. L'ordre EST la hierarchie promise au joueur. */
export const RARITY_ORDER: readonly Rarity[] = ['default', 'common', 'rare', 'epic', 'legendary'];

const PRICES: Readonly<Record<Rarity, number>> = {
  default: 0,
  common: 90,
  rare: 400,
  epic: 850,
  legendary: 1_500,
};

export function priceForRarity(rarity: Rarity): number {
  return PRICES[rarity];
}

/** Un cosmetique, reduit a ce que le bareme doit verifier. */
export interface PricedCosmetic {
  readonly id: string;
  readonly rarity: Rarity;
  readonly price: number;
}

/**
 * Les cosmetiques que ce paquet peut enumerer, tous catalogues confondus.
 *
 * Les danses n'y sont pas : leur rarete vit dans leur fichier JSON, et
 * `import.meta.glob` est une construction de Vite que ce paquet, consomme par
 * le serveur en Node, ne peut pas utiliser. La recopier ici en ferait une
 * troisieme source de verite — le defaut que ce depot a deja paye trois fois.
 * Le client, lui, a les animations chargees : il applique `priceForRarity` a
 * la rarete qu'il y lit.
 */
export function allCosmetics(): readonly PricedCosmetic[] {
  return [...AURA_EFFECTS, ...EMOTES].map((item) => ({
    id: item.id,
    rarity: item.rarity,
    price: item.price,
  }));
}
