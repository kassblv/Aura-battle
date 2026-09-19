import { AURA_COLORS, HAIRSTYLES, OUTFITS, SKIN_TONES } from '@aura/content';
import { describe, expect, it } from 'vitest';
import {
  defaultLook,
  equip,
  isOwned,
  priceOf,
  wardrobeSections,
  type Wardrobe,
} from './wardrobe.js';

const free = (): Wardrobe => ({
  look: defaultLook(),
  owned: new Set(
    [...OUTFITS, ...HAIRSTYLES, ...AURA_COLORS].filter((i) => i.price === 0).map((i) => i.id),
  ),
});

describe('defaultLook', () => {
  it('habille tout le monde sans rien acheter', () => {
    const look = defaultLook();
    const outfit = OUTFITS.find((o) => o.id === look.outfit);
    const hair = HAIRSTYLES.find((h) => h.id === look.hair);
    expect(outfit?.price).toBe(0);
    expect(hair?.price).toBe(0);
    expect(SKIN_TONES).toContain(look.skin);
  });
});

describe('wardrobeSections', () => {
  it('range le catalogue par nature, dans l ordre ou on s habille', () => {
    expect(wardrobeSections().map((s) => s.id)).toEqual(['outfit', 'hair', 'skin', 'aura']);
  });

  it('expose le catalogue reel, pas une copie locale', () => {
    const sections = wardrobeSections();
    expect(sections[0]?.items).toHaveLength(OUTFITS.length);
    expect(sections[1]?.items).toHaveLength(HAIRSTYLES.length);
    expect(sections[2]?.items).toHaveLength(SKIN_TONES.length);
    expect(sections[3]?.items).toHaveLength(AURA_COLORS.length);
  });

  /**
   * Regle d or n°3. Le test est ici plutot que dans une revue : c est la seule
   * garantie qui survit a l ajout d un objet six mois plus tard.
   */
  it('ne laisse aucun objet porter une valeur de jeu', () => {
    for (const section of wardrobeSections()) {
      for (const item of section.items) {
        const keys = Object.keys(item);
        expect(keys).not.toContain('power');
        expect(keys).not.toContain('multiplier');
        expect(keys).not.toContain('energy');
        expect(keys).not.toContain('bonus');
      }
    }
  });

  it('offre les teintes de peau : une apparence de base ne se vend pas', () => {
    const skins = wardrobeSections().find((s) => s.id === 'skin');
    for (const item of skins?.items ?? []) expect(item.price).toBe(0);
  });
});

describe('equip', () => {
  it('change la piece demandee et ne touche pas les autres', () => {
    const before = free();
    const after = equip(before, 'outfit', 'outfit.blanc');
    expect(after.look.outfit).toBe('outfit.blanc');
    expect(after.look.hair).toBe(before.look.hair);
    expect(after.look.skin).toBe(before.look.skin);
  });

  it('refuse un objet qu on ne possede pas', () => {
    const wardrobe = free();
    // `outfit.dore` coute 700 : personne ne le porte sans l avoir achete.
    expect(equip(wardrobe, 'outfit', 'outfit.dore')).toBe(wardrobe);
  });

  it('refuse un identifiant inconnu', () => {
    const wardrobe = free();
    expect(equip(wardrobe, 'hair', 'hair.inexistante')).toBe(wardrobe);
  });

  it('ne fabrique pas un nouvel etat quand la piece est deja portee', () => {
    const wardrobe = free();
    expect(equip(wardrobe, 'outfit', wardrobe.look.outfit)).toBe(wardrobe);
  });

  it('accepte toutes les teintes de peau sans les posseder', () => {
    const bare: Wardrobe = { look: defaultLook(), owned: new Set() };
    const tone = SKIN_TONES[2] ?? '#a8714b';
    expect(equip(bare, 'skin', tone).look.skin).toBe(tone);
  });
});

describe('isOwned et priceOf', () => {
  it('tient tout ce qui est gratuit pour acquis', () => {
    const bare: Wardrobe = { look: defaultLook(), owned: new Set() };
    expect(isOwned(bare, 'outfit.noir')).toBe(true);
    expect(isOwned(bare, 'outfit.dore')).toBe(false);
  });

  it('donne le prix affiche, zero pour l inconnu', () => {
    expect(priceOf('outfit.dore')).toBe(700);
    expect(priceOf('color.gold')).toBe(0);
    expect(priceOf('rien')).toBe(0);
  });
});
