import { AURA_COLORS, isExclusive, OUTFITS } from '@aura/content';
import { describe, expect, it } from 'vitest';
import { catalogueTerms } from './catalogue-terms.js';
import { isOffered, purchaseOutcome, type CatalogueEntry } from './purchase.js';

/*
  La garantie serveur des exclusifs de saison tient a CETTE regle du seed :
  sans prix et en rarete legendaire. Ecrits a 0 piece en rarete « default »,
  ils seraient tenus pour offerts a TOUS (`isOffered`) — et tous les autres
  tests resteraient verts.
*/
describe('catalogueTerms — les exclusifs ne sont ni offerts ni vendus', () => {
  const entry = (
    item: { id: string; price: number; exclusive?: string },
    kind: CatalogueEntry['kind'],
  ): CatalogueEntry => {
    const terms = catalogueTerms(item);
    return {
      id: item.id,
      kind,
      rarity: terms.rarity,
      priceSoft: terms.priceSoft,
      priceHard: null,
      availableFrom: null,
      availableTo: null,
    };
  };
  const exclusives = [
    ...AURA_COLORS.filter((c) => isExclusive(c.id)).map((c) => entry(c, 'AURA_COLOR')),
    ...OUTFITS.filter((o) => isExclusive(o.id)).map((o) => entry(o, 'OUTFIT')),
  ];

  it('couvre les exclusifs du catalogue', () => {
    expect(exclusives.length).toBeGreaterThanOrEqual(2);
  });

  it('ne les offre a personne', () => {
    for (const item of exclusives) expect(isOffered(item), item.id).toBe(false);
  });

  it('ne les vend pas, meme a une bourse pleine', () => {
    for (const item of exclusives) {
      expect(
        purchaseOutcome({ item, wallet: { soft: 1e6, hard: 1e6 }, owned: false, now: new Date() }),
        item.id,
      ).toEqual({ ok: false, reason: 'NOT_PURCHASABLE' });
    }
  });

  it('laisse un article gratuit ordinaire offert a tous', () => {
    expect(isOffered(entry({ id: 'color.gold', price: 0 }, 'AURA_COLOR'))).toBe(true);
  });
});
