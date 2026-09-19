import { describe, expect, it } from 'vitest';
import {
  AURA_COLORS,
  AURA_EFFECTS,
  defaultEffectForLevel,
  effectsForLevel,
  HAIRSTYLES,
  OUTFITS,
  SKIN_TONES,
  type AmplifierLevel,
  EMOTES,
  EMOTE_SLOTS,
} from './cosmetics.js';

const LEVELS: readonly AmplifierLevel[] = [0, 1, 2, 3, 4];

describe('aucun avantage payant (regle d or n°3)', () => {
  it('ne laisse aucun cosmetique porter de valeur de jeu', () => {
    const interdits = ['mult', 'multiplier', 'power', 'cost', 'bonus', 'damage'];
    const catalogues = [...AURA_EFFECTS, ...AURA_COLORS, ...HAIRSTYLES, ...OUTFITS];
    for (const item of catalogues) {
      for (const cle of Object.keys(item)) {
        expect(interdits).not.toContain(cle);
      }
    }
  });

  it('offre un effet d aura a chaque niveau d amplificateur', () => {
    for (const level of LEVELS) {
      expect(defaultEffectForLevel(level).price).toBe(0);
    }
  });

  it('offre au moins une tenue et une coiffure', () => {
    expect(OUTFITS.some((outfit) => outfit.price === 0)).toBe(true);
    expect(HAIRSTYLES.some((hair) => hair.price === 0)).toBe(true);
    expect(AURA_COLORS.some((color) => color.price === 0)).toBe(true);
  });
});

describe('AURA_EFFECTS', () => {
  it('porte les huit effets du prototype', () => {
    expect(AURA_EFFECTS).toHaveLength(8);
  });

  it('couvre les cinq niveaux d amplificateur', () => {
    for (const level of LEVELS) {
      expect(effectsForLevel(level).length).toBeGreaterThan(0);
    }
  });

  it('range les effets supplementaires en skins d un niveau existant', () => {
    expect(effectsForLevel(1).map((effect) => effect.id)).toEqual(['fx.sparks', 'fx.flames']);
    expect(effectsForLevel(2).map((effect) => effect.id)).toEqual(['fx.lightning', 'fx.shock']);
    expect(effectsForLevel(3).map((effect) => effect.id)).toEqual(['fx.vortex', 'fx.dark']);
  });

  it('nomme exactement un effet par defaut par niveau', () => {
    for (const level of LEVELS) {
      const defauts = effectsForLevel(level).filter((effect) => effect.rarity === 'default');
      expect(defauts).toHaveLength(1);
    }
  });
});

describe('catalogues', () => {
  it('n utilise jamais deux fois le meme identifiant', () => {
    const ids = [...AURA_EFFECTS, ...AURA_COLORS, ...HAIRSTYLES, ...OUTFITS].map((item) => item.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('exprime toutes les couleurs en hexadecimal', () => {
    const hex = /^#[0-9a-f]{6}$/;
    for (const color of AURA_COLORS) expect(color.hex).toMatch(hex);
    for (const tone of SKIN_TONES) expect(tone).toMatch(hex);
    for (const outfit of OUTFITS) {
      expect(outfit.jacket).toMatch(hex);
      expect(outfit.pants).toMatch(hex);
      expect(outfit.shoes).toMatch(hex);
    }
  });

  it('ne vend jamais une teinte de peau', () => {
    expect(SKIN_TONES).toHaveLength(4);
  });

  it('gele les catalogues', () => {
    expect(Object.isFrozen(AURA_EFFECTS)).toBe(true);
    expect(Object.isFrozen(OUTFITS)).toBe(true);
  });
});

describe('EMOTES', () => {
  it('offre de quoi se saluer sans rien acheter', () => {
    const free = EMOTES.filter((emote) => emote.price === 0);
    expect(free.length).toBeGreaterThanOrEqual(EMOTE_SLOTS);
  });

  it('donne un symbole a chacune : une emote se lit, elle ne se dechiffre pas', () => {
    for (const emote of EMOTES) {
      expect(emote.glyph.length).toBeGreaterThan(0);
      expect(emote.name.fr.length).toBeGreaterThan(0);
    }
  });

  it('n attribue pas deux fois le meme identifiant', () => {
    expect(new Set(EMOTES.map((e) => e.id)).size).toBe(EMOTES.length);
  });

  /**
   * Regle d'or n°3. Une emote ne porte aucune valeur de jeu — et surtout pas
   * le style joue : `intent:show` existe pour l'annoncer, et il se paie en
   * jauge d'Ultime. Une emote qui dirait la meme chose rendrait ce cout nul.
   */
  it('ne porte aucune valeur de jeu', () => {
    for (const emote of EMOTES) {
      const keys = Object.keys(emote);
      expect(keys).not.toContain('style');
      expect(keys).not.toContain('power');
      expect(keys).not.toContain('multiplier');
      expect(keys).not.toContain('energy');
    }
  });

  it('garde assez d emotes gratuites pour remplir la roue', () => {
    // Un joueur sans un sou doit pouvoir equiper ses quatre emplacements.
    expect(EMOTES.filter((e) => e.price === 0)).toHaveLength(EMOTE_SLOTS);
  });
});
