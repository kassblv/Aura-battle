import { HAIRSTYLES, OUTFITS } from '@aura/content';
import { describe, expect, it } from 'vitest';
import { discountedPrice, featuredForDay } from '@aura/content';
import { memeGallery } from './memes.js';
import { buy, shopSections, type ShopState } from './shop.js';

const state = (soft: number, owned: string[] = []): ShopState => ({
  wallet: { soft, hard: 0 },
  owned: new Set(owned),
});

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

describe('buy', () => {
  const gold = OUTFITS.find((outfit) => outfit.price > 0);

  it('debite le prix et ajoute l objet', () => {
    if (gold === undefined) throw new Error('aucune tenue payante');
    const after = buy(state(gold.price), gold.id);
    expect(after.wallet.soft).toBe(0);
    expect(after.owned.has(gold.id)).toBe(true);
  });

  it('refuse quand la monnaie manque', () => {
    if (gold === undefined) throw new Error('aucune tenue payante');
    const before = state(gold.price - 1);
    expect(buy(before, gold.id)).toBe(before);
  });

  /**
   * Racheter ce qu'on possede deja debiterait deux fois. Ce n'est pas une
   * hypothese d'ecole : un double appui sur un bouton de boutique est la chose
   * la plus courante du monde.
   */
  it('refuse un objet deja possede, sans rien debiter', () => {
    if (gold === undefined) throw new Error('aucune tenue payante');
    const before = state(1000, [gold.id]);
    expect(buy(before, gold.id)).toBe(before);
    expect(before.wallet.soft).toBe(1000);
  });

  it('refuse un identifiant inconnu', () => {
    const before = state(1000);
    expect(buy(before, 'objet.inexistant')).toBe(before);
  });

  it('refuse d acheter ce qui est offert', () => {
    // Le debit serait de zero, mais l'objet entrerait dans la liste des
    // possessions et brouillerait la distinction entre offert et achete.
    const free = HAIRSTYLES.find((hair) => hair.price === 0);
    if (free === undefined) throw new Error('aucune coiffure offerte');
    const before = state(1000);
    expect(buy(before, free.id)).toBe(before);
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

  it('laisse acheter une danse et la porte au credit du joueur', () => {
    const cible = memeGallery().find((card) => !card.free)!;
    const avant: ShopState = { wallet: { soft: 5_000, hard: 0 }, owned: new Set<string>() };
    const apres = buy(avant, cible.animationId);
    expect(apres.owned.has(cible.animationId)).toBe(true);
    expect(apres.wallet.soft).toBe(5_000 - cible.price);
  });

  it('refuse une danse hors budget', () => {
    const cible = memeGallery().find((card) => !card.free)!;
    const avant: ShopState = { wallet: { soft: 0, hard: 0 }, owned: new Set<string>() };
    expect(buy(avant, cible.animationId)).toBe(avant);
  });
});
