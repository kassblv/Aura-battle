import { describe, expect, it } from 'vitest';
import { allCosmetics, priceForRarity, RARITY_ORDER } from './pricing.js';

describe('bareme de rarete', () => {
  it('donne un prix a chaque rarete', () => {
    for (const rarity of RARITY_ORDER) {
      expect(priceForRarity(rarity)).toBeGreaterThanOrEqual(0);
    }
  });

  it('n exige rien pour ce qui est offert', () => {
    expect(priceForRarity('default')).toBe(0);
  });

  /**
   * Plus rare, plus cher — sans exception.
   *
   * C'est ce que la rarete PROMET au joueur. Un legendaire moins cher qu'un
   * epique lui apprend que le mot ne veut rien dire, et c'est le genre de
   * detail qui decredibilise une boutique entiere.
   */
  it('monte strictement avec la rarete', () => {
    const prices = RARITY_ORDER.map(priceForRarity);
    for (let i = 1; i < prices.length; i++) {
      expect(prices[i]!).toBeGreaterThan(prices[i - 1]!);
    }
  });
});

describe('catalogue complet', () => {
  /**
   * L'invariant applique a la DONNEE reellement livree.
   *
   * Le bareme ne sert a rien si les entrees du catalogue s'en ecartent une a
   * une : c'est ainsi qu'on se retrouve avec une emote legendaire a 900 pieces
   * a cote d'un effet epique a 1 250.
   */
  it('facture chaque cosmetique au tarif de sa rarete', () => {
    for (const item of allCosmetics()) {
      expect({ id: item.id, price: item.price }).toEqual({
        id: item.id,
        price: priceForRarity(item.rarity),
      });
    }
  });

  /**
   * Seuls les catalogues qui PORTENT une rarete sont concernes.
   *
   * Couleurs, tenues et coiffures n'ont qu'un prix : rien n'y promet une
   * hierarchie, donc rien n'y est trahi. Les y forcer demanderait de leur
   * inventer une rarete apres coup, et une rarete inventee est une troisieme
   * source de verite.
   */
  it('couvre les effets d aura et les emotes', () => {
    const ids = allCosmetics().map((item) => item.id);
    for (const prefix of ['fx.', 'emote.']) {
      expect(ids.some((id) => id.startsWith(prefix))).toBe(true);
    }
  });

  /** Aucun doublon : deux entrees du meme identifiant seraient deux prix. */
  it('ne liste chaque cosmetique qu une fois', () => {
    const ids = allCosmetics().map((item) => item.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
