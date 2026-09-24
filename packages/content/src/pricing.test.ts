import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { allAnimationIds, defaultAnimationFor, STYLES, TIERS } from './catalogue.js';
import type { Rarity } from './cosmetics.js';
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

describe('offert = rarete par defaut', () => {
  /*
    Le serveur n'offre a tout le monde que ce qui porte la rarete `default`
    (`ownedWithFree`). Un objet a zero sous une autre rarete serait affiche
    « offert » par le client et pourtant jamais possede cote serveur — ou, si
    la regle serveur se relachait, donne a tous alors que la boutique le vend.
    La donnee livree doit donc tenir les deux ensemble.
  */
  const animationsRoot = fileURLToPath(new URL('../animations/', import.meta.url));

  /** Chaque animation livree, avec la rarete lue dans son fichier. */
  const shipped = readdirSync(animationsRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .flatMap((folder) =>
      readdirSync(`${animationsRoot}${folder.name}`)
        .filter((file) => file.endsWith('.json'))
        .map((file) => {
          const document = JSON.parse(
            readFileSync(`${animationsRoot}${folder.name}/${file}`, 'utf8'),
          ) as { id: string; rarity?: Rarity };
          // Meme repli que le seed : sans rarete, c'est `default`.
          const rarity = document.rarity ?? 'default';
          return { id: document.id, rarity, price: animationPrice(document.id, rarity) };
        }),
    );

  const priced = [...allCosmetics(), ...shipped];

  it('lit toutes les animations du catalogue', () => {
    expect(shipped.map((item) => item.id).sort()).toEqual([...allAnimationIds()].sort());
  });

  it('refuse un prix de zero hors de la rarete par defaut', () => {
    const offenders = priced.filter((item) => item.price === 0 && item.rarity !== 'default');
    expect(offenders).toEqual([]);
  });

  it('ne vend rien de ce qui porte la rarete par defaut', () => {
    const offenders = priced.filter((item) => item.rarity === 'default' && item.price !== 0);
    expect(offenders).toEqual([]);
  });
});
