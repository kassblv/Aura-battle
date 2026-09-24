import { describe, expect, it } from 'vitest';
import { allAnimationIds, defaultAnimationFor, STYLES, TIERS } from './catalogue.js';
import { allCosmetics, animationPrice, priceForRarity, RARITY_ORDER } from './pricing.js';

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
   * une : c'est ainsi qu'on s'etait retrouve avec un legendaire a 900 pieces a
   * cote d'un epique a 1 250.
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
  it('couvre les effets d aura', () => {
    const ids = allCosmetics().map((item) => item.id);
    expect(ids.some((id) => id.startsWith('fx.'))).toBe(true);
  });

  /** Aucun doublon : deux entrees du meme identifiant seraient deux prix. */
  it('ne liste chaque cosmetique qu une fois', () => {
    const ids = allCosmetics().map((item) => item.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('prix d une animation — une seule regle, pour le client ET le serveur', () => {
  /*
    Le client appliquait docs/01 §2 (la premiere animation de chaque case est
    offerte, les autres se vendent selon leur rarete) ; le seed du serveur
    mettait TOUTES les animations a zero. Le serveur les donnait donc a tout le
    monde, et la boutique affichait en tete dix-huit danses « acquises » qu'on
    ne pouvait pas acheter.
  */
  it('offre la premiere animation de chaque case, quelle que soit sa rarete', () => {
    for (const style of STYLES) {
      for (const tier of TIERS) {
        expect(animationPrice(defaultAnimationFor({ style, tier }), 'legendary')).toBe(0);
      }
    }
  });

  it('offre les animations systeme', () => {
    expect(animationPrice('anim.system.none.victory', 'rare')).toBe(0);
  });

  it('fait payer les autres selon le bareme', () => {
    const paid = allAnimationIds().filter(
      (id) => !id.startsWith('anim.system.') && animationPrice(id, 'rare') > 0,
    );
    expect(paid.length).toBeGreaterThan(0);
    for (const id of paid) expect(animationPrice(id, 'epic')).toBe(priceForRarity('epic'));
  });
});
