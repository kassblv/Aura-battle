import { OUTFITS } from '@aura/content';
import { describe, expect, it } from 'vitest';
import { discountedPrice, featuredForDay, tokenPrice } from '@aura/content';
import { memeGallery } from './memes.js';
import { buyOptions, nextTrying, shopSections } from './shop.js';

/*
  Un jour fixe : la vitrine depend du jour, donc les tests aussi. Le prendre a
  l'horloge ferait echouer la suite une fois sur cinq, le jour ou la vitrine
  contient l'article que tel test suppose absent.
*/
const DAY = 20_718;

describe('shopSections', () => {
  it('range le catalogue par nature', () => {
    expect(shopSections(DAY).map((section) => section.id)).toEqual([
      'featured',
      'dance',
      'outfit',
      'hair',
      'effect',
      'aura',
    ]);
  });

  /*
    Les trois effets payants etaient invendables : le catalogue les portait,
    le serveur savait les vendre, le protocole les transportait, l'arene savait
    les dessiner — et aucun ecran ne les montrait. Ils sont les plus
    spectaculaires du jeu, donc exactement ce que la boutique existe pour
    vendre (regle d'or n°3).
  */
  it('met en vente les effets d aura payants', () => {
    const effets = shopSections(DAY).find((section) => section.id === 'effect');
    expect(effets?.items.map((item) => item.id).sort()).toEqual([
      'fx.dark',
      'fx.flames',
      'fx.shock',
    ]);
  });

  /*
    Le niveau fait partie de ce qu'on achete : un skin habille UN amplificateur
    (docs/01 §3). Le taire laisserait croire a un effet permanent, et le joueur
    se sentirait vole la premiere fois qu'il jouerait un autre palier.
  */
  it('dit a quel amplificateur chaque effet appartient', () => {
    const effets = shopSections(DAY).find((section) => section.id === 'effect');
    expect(effets?.items.map((item) => item.name)).toEqual([
      'Flammes · A1',
      'Onde de choc · A2',
      'Aura noire · A3',
    ]);
  });

  it('ne met en vente que ce qui a un prix', () => {
    // Ce qui est offert appartient deja a tout le monde : l'afficher a zero
    // franc donnerait a un joueur l'impression d'avoir a l'acheter.
    for (const section of shopSections(DAY)) {
      for (const item of section.items) expect(item.price).toBeGreaterThan(0);
    }
  });

  it('expose le catalogue reel', () => {
    const tenues = shopSections(DAY).find((section) => section.id === 'outfit');
    expect(tenues?.items).toHaveLength(OUTFITS.filter((outfit) => outfit.price > 0).length);
  });

  /**
   * Regle d'or n°3, verifiee a l'endroit ou l'argent change de main : rien de
   * ce qui est en vente ne porte de valeur de jeu.
   */
  it('ne vend aucune valeur de jeu', () => {
    for (const section of shopSections(DAY)) {
      for (const item of section.items) {
        const keys = Object.keys(item);
        expect(keys).not.toContain('power');
        expect(keys).not.toContain('multiplier');
        expect(keys).not.toContain('energy');
        expect(keys).not.toContain('bonus');
      }
    }
  });
});

describe('vitrine du jour', () => {
  const vitrine = shopSections(DAY).find((section) => section.id === 'featured');

  it('reprend exactement les articles du jour', () => {
    expect(vitrine?.items.map((item) => item.id).sort()).toEqual([...featuredForDay(DAY)].sort());
  });

  /*
    Elle AJOUTE, elle ne retire pas : chaque article de la vitrine figure aussi
    dans son rayon, au prix plein. Cacher le reste derriere une rotation ferait
    attendre des semaines quelqu'un qui veut un article precis.
  */
  it('laisse chaque article dans son rayon, au prix plein', () => {
    for (const item of vitrine?.items ?? []) {
      const ailleurs = shopSections(DAY)
        .filter((section) => section.id !== 'featured')
        .flatMap((section) => section.items)
        .find((entry) => entry.id === item.id);
      expect(ailleurs, item.id).toBeDefined();
      expect(ailleurs?.price, item.id).toBe(item.fullPrice);
    }
  });

  it('affiche un prix remise, et le prix plein a cote', () => {
    for (const item of vitrine?.items ?? []) {
      expect(item.fullPrice, item.id).toBeGreaterThan(item.price);
      expect(item.price, item.id).toBe(discountedPrice(item.fullPrice ?? 0));
    }
  });

  /*
    Hors vitrine, pas de prix plein : porter les deux partout inviterait a
    afficher une fausse remise le jour ou quelqu'un lit `fullPrice` sans
    verifier le rayon.
  */
  it('ne porte un prix plein que dans la vitrine', () => {
    for (const section of shopSections(DAY)) {
      if (section.id === 'featured') continue;
      for (const item of section.items) {
        expect(item.fullPrice, `${section.id} : ${item.id}`).toBeUndefined();
      }
    }
  });
});

describe('danses en boutique', () => {
  const dances = shopSections(DAY).find((section) => section.id === 'dance');

  /*
    Les danses restent le premier RAYON — une aura battle est un clash ou deux
    personnes rejouent des memes, et la danse est ce que le joueur vient
    chercher. La vitrine passe au-dessus parce que ce n'est pas un rayon : c'est
    un bandeau de trois articles qui change chaque jour, et sa raison d'etre est
    d'etre vue en ouvrant.
  */
  it('met les danses en tete des rayons', () => {
    const rayons = shopSections(DAY).filter((section) => section.id !== 'featured');
    expect(rayons[0]?.id).toBe('dance');
  });

  it('ne laisse que la vitrine passer devant elles', () => {
    expect(shopSections(DAY)[0]?.id).toBe('featured');
  });

  it('vend exactement les memes qui ne sont pas offerts', () => {
    const payantes = memeGallery().filter((card) => !card.free);
    expect(dances?.items.map((item) => item.id).sort()).toEqual(
      payantes.map((card) => card.animationId).sort(),
    );
  });

  /**
   * Ce qui est offert n'est pas a vendre.
   *
   * L'afficher a zero franc donnerait au joueur l'impression d'avoir a
   * l'acheter — et la premiere animation de chaque mouvement est offerte.
   */
  it('n expose aucune danse offerte', () => {
    expect(dances?.items.every((item) => item.price > 0)).toBe(true);
  });
});

/*
  Le prix en jetons affiche doit etre CELUI QUE LE SERVEUR FACTURE : la vitrine
  remise le prix en jetons du catalogue, elle ne convertit pas le prix remise.
  (9 jetons −30 % = 6 ; convertir 63 pieces donnerait 7.)
*/
describe('prix en jetons', () => {
  it('porte le prix en jetons de chaque article payant', () => {
    for (const section of shopSections(0).filter((s) => s.id !== 'featured')) {
      for (const item of section.items) expect(item.tokens).toBe(tokenPrice(item.price));
    }
  });

  it('remise en vitrine le prix en jetons comme le serveur', () => {
    const day = 0;
    const featured = shopSections(day).find((s) => s.id === 'featured');
    expect(featured).toBeDefined();
    for (const item of featured!.items) {
      expect(item.tokens).toBe(discountedPrice(tokenPrice(item.fullPrice!)));
    }
  });
});

/* La barre d'achat de l'article essaye : deux monnaies, chacune jugee seule. */
describe('buyOptions', () => {
  const item = { id: 'x', name: 'X', price: 400, tokens: 40 };

  it('propose les deux monnaies, chacune avec son prix et sa bourse', () => {
    expect(buyOptions(item, { soft: 500, hard: 10 }, false)).toEqual({
      soft: { price: 400, afford: true },
      hard: { price: 40, afford: false },
    });
  });

  it('ne propose rien pour un article deja possede', () => {
    expect(buyOptions(item, { soft: 500, hard: 500 }, true)).toBeNull();
  });
});

/*
  Retoucher l'article essaye. L'ancien geste (« retoucher achete ») est dans
  les doigts : sur un article pas encore a soi, le retirer ferait disparaitre
  la barre d'achat sous le pouce qui venait l'utiliser.
*/
describe('nextTrying', () => {
  it('essaie un nouvel article', () => {
    expect(nextTrying('a', 'b', false)).toBe('b');
    expect(nextTrying(null, 'b', false)).toBe('b');
  });

  it('garde a l essai un article pas encore possede', () => {
    expect(nextTrying('a', 'a', false)).toBe('a');
  });

  it('repose un article possede, pour se comparer sans lui', () => {
    expect(nextTrying('a', 'a', true)).toBeNull();
  });
});
