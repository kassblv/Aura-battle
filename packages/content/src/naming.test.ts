import { describe, expect, it } from 'vitest';
import { STYLES, TIERS } from './catalogue.js';
import { AMPLIFIER_LEVELS, defaultEffectForLevel } from './cosmetics.js';
import { amplifierName, styleName, tierName } from './naming.js';

describe('noms affiches', () => {
  it('nomme chaque palier', () => {
    for (const tier of TIERS) {
      expect(tierName(tier).fr).not.toBe('');
    }
  });

  /**
   * Un palier se lit sur un bouton de quelques dizaines de pixels, en paysage,
   * a cote de quatre autres. Un nom qui s'y tronque ne nomme rien.
   */
  it('garde des noms de palier assez courts pour un bouton', () => {
    for (const tier of TIERS) {
      expect(tierName(tier).fr.length).toBeLessThanOrEqual(10);
    }
  });

  it('donne un nom distinct a chaque palier', () => {
    const names = new Set(TIERS.map((tier) => tierName(tier).fr));
    expect(names.size).toBe(TIERS.length);
  });

  it('nomme chaque style', () => {
    const names = new Set(STYLES.map((style) => styleName(style).fr));
    expect(names.size).toBe(STYLES.length);
    for (const style of STYLES) {
      expect(styleName(style).fr).not.toBe('');
    }
  });

  /**
   * L'amplificateur porte le nom de son effet offert, jamais un nom invente en
   * plus. Deux sources pour la meme chose finiraient par se contredire, et
   * c'est l'effet que le joueur voit tourner autour de son aura.
   */
  it('nomme l amplificateur par son effet offert', () => {
    for (const level of AMPLIFIER_LEVELS) {
      expect(amplifierName(level).fr).toBe(defaultEffectForLevel(level).name.fr);
    }
  });

  it('donne un nom distinct a chaque amplificateur', () => {
    const names = new Set(AMPLIFIER_LEVELS.map((level) => amplifierName(level).fr));
    expect(names.size).toBe(AMPLIFIER_LEVELS.length);
  });
});
