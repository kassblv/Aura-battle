import { HAIRSTYLES, OUTFITS } from '@aura/content';
import { describe, expect, it } from 'vitest';
import { memeGallery } from './memes.js';
import { buy, shopSections, type ShopState } from './shop.js';

const state = (soft: number, owned: string[] = []): ShopState => ({
  wallet: { soft, hard: 0 },
  owned: new Set(owned),
});

describe('shopSections', () => {
  it('range le catalogue par nature', () => {
    expect(shopSections().map((section) => section.id)).toEqual([
      'dance',
      'outfit',
      'hair',
      'aura',
    ]);
  });

  it('ne met en vente que ce qui a un prix', () => {
    // Ce qui est offert appartient deja a tout le monde : l'afficher a zero
    // franc donnerait a un joueur l'impression d'avoir a l'acheter.
    for (const section of shopSections()) {
      for (const item of section.items) expect(item.price).toBeGreaterThan(0);
    }
  });

  it('expose le catalogue reel', () => {
    const tenues = shopSections().find((section) => section.id === 'outfit');
    expect(tenues?.items).toHaveLength(OUTFITS.filter((outfit) => outfit.price > 0).length);
  });

  /**
   * Regle d'or n°3, verifiee a l'endroit ou l'argent change de main : rien de
   * ce qui est en vente ne porte de valeur de jeu.
   */
  it('ne vend aucune valeur de jeu', () => {
    for (const section of shopSections()) {
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

describe('danses en boutique', () => {
  const dances = shopSections().find((section) => section.id === 'dance');

  it('met les danses en tete de l etalage', () => {
    expect(shopSections()[0]?.id).toBe('dance');
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
