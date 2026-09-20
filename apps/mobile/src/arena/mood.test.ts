import { describe, expect, it } from 'vitest';
import { arenaMood, mixRgb, moodCurve, srgb, type Rgb } from './mood.js';

/** Luminosite percue, pour comparer deux ambiances sans lire trois canaux. */
function luma([r, g, b]: Rgb): number {
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** Chaleur : combien le rouge l emporte sur le bleu. */
function warmth([r, , b]: Rgb): number {
  return r - b;
}

describe('srgb', () => {
  it('lit une couleur telle qu elle est ecrite, sans passer par le lineaire', () => {
    expect(srgb('#ffcf3f')).toEqual([1, 207 / 255, 63 / 255]);
    expect(srgb('#000000')).toEqual([0, 0, 0]);
  });

  it('refuse un hexadecimal mal forme', () => {
    expect(() => srgb('ffcf3f')).toThrow(/hexadecimal/);
    expect(() => srgb('#fff')).toThrow(/hexadecimal/);
  });
});

describe('mixRgb', () => {
  it('interpole canal par canal', () => {
    expect(mixRgb([0, 0, 0], [1, 0.5, 0.25], 0.5)).toEqual([0.5, 0.25, 0.125]);
  });

  it('borne le melange : une ferveur hors bornes ne depasse pas les extremes', () => {
    expect(mixRgb([0, 0, 0], [1, 1, 1], -3)).toEqual([0, 0, 0]);
    expect(mixRgb([0, 0, 0], [1, 1, 1], 9)).toEqual([1, 1, 1]);
  });
});

describe('moodCurve', () => {
  /**
   * La ferveur passe l essentiel du match entre 0,2 et 0,5 : une droite y
   * laisserait la salle tiede du debut a la fin.
   */
  it('donne du relief des les ferveurs basses', () => {
    expect(moodCurve(0.25)).toBeGreaterThan(0.25);
    expect(moodCurve(0.25)).toBeCloseTo(0.5, 6);
  });

  it('tient ses deux extremes', () => {
    expect(moodCurve(0)).toBe(0);
    expect(moodCurve(1)).toBe(1);
  });

  it('borne une ferveur hors bornes', () => {
    expect(moodCurve(-1)).toBe(0);
    expect(moodCurve(4)).toBe(1);
  });
});

describe('arenaMood', () => {
  it('monte en lumiere avec la ferveur', () => {
    const calm = arenaMood(0);
    const blaze = arenaMood(1);
    expect(blaze.ambientIntensity).toBeGreaterThan(calm.ambientIntensity);
    expect(blaze.keyIntensity).toBeGreaterThan(calm.keyIntensity);
    expect(blaze.backIntensity).toBeGreaterThan(calm.backIntensity);
    expect(luma(blaze.keyColor)).toBeGreaterThan(luma(calm.keyColor));
  });

  /**
   * Le contre-jour doit gagner **plus vite** que la lumiere principale : c est
   * lui qui detoure les combattants, et plus la salle se remplit de lumiere,
   * plus ils risquent de se fondre dedans.
   */
  it('renforce le contre-jour plus vite que la principale', () => {
    const calm = arenaMood(0);
    const blaze = arenaMood(1);
    const backGain = blaze.backIntensity / calm.backIntensity;
    const keyGain = blaze.keyIntensity / calm.keyIntensity;
    expect(backGain).toBeGreaterThan(keyGain);
  });

  it('bascule du froid au chaud', () => {
    expect(warmth(arenaMood(1).keyColor)).toBeGreaterThan(warmth(arenaMood(0).keyColor));
    expect(warmth(arenaMood(1).rimColor)).toBeGreaterThan(warmth(arenaMood(0).rimColor));
  });

  it('leve la brume et devoile les faisceaux quand la salle s embrase', () => {
    expect(arenaMood(1).hazeOpacity).toBeGreaterThan(arenaMood(0).hazeOpacity);
    expect(arenaMood(1).sweepOpacity).toBeGreaterThan(arenaMood(0).sweepOpacity);
  });

  /**
   * Un voile additif qui depasse ces valeurs mange le decor : on ne peint pas
   * une ambiance, on eteint une arene dans du blanc.
   */
  it('garde la brume et les faisceaux discrets', () => {
    for (const hype of [0, 0.3, 0.6, 1]) {
      expect(arenaMood(hype).hazeOpacity).toBeLessThan(0.45);
      expect(arenaMood(hype).sweepOpacity).toBeLessThan(0.07);
    }
  });

  it('borne une ferveur hors bornes plutot que de sortir du decor', () => {
    expect(arenaMood(4)).toEqual(arenaMood(1));
    expect(arenaMood(-2)).toEqual(arenaMood(0));
  });

  it('avance de facon continue, sans marche entre deux images', () => {
    let previous = arenaMood(0).keyIntensity;
    for (let i = 1; i <= 20; i++) {
      const current = arenaMood(i / 20).keyIntensity;
      expect(current).toBeGreaterThanOrEqual(previous);
      expect(current - previous).toBeLessThan(0.2);
      previous = current;
    }
  });
});
