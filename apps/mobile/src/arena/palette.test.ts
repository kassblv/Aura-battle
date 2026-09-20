import { describe, expect, it } from 'vitest';
import { ARENA_COLORS, ARENA_MOOD, colorOf, withAlpha } from './palette.js';

/** Luminosite percue d une couleur ecrite en hexadecimal, entre 0 et 1. */
function luma(hex: string): number {
  const n = Number.parseInt(hex.slice(1), 16);
  return (0.2126 * ((n >> 16) & 255) + 0.7152 * ((n >> 8) & 255) + 0.0722 * (n & 255)) / 255;
}

describe('palette de l arene', () => {
  it('garde le violet nuit du prototype', () => {
    expect(ARENA_COLORS.background).toBe('#0d0620');
    expect(ARENA_COLORS.rim).toBe('#b36bff');
    expect(ARENA_COLORS.strips).toEqual(['#4fe3ff', '#ff4fa3']);
  });

  /**
   * Le decor doit s etager en valeurs, du fond au cercle.
   *
   * C est la seule chose qui fasse tenir la lecture d une arene entierement
   * violette : si le bitume, les gradins et la plateforme se valent, les deux
   * combattants se decoupent sur une bouillie uniforme.
   */
  it('etage le decor du plus sombre au plus clair', () => {
    expect(luma(ARENA_COLORS.ground)).toBeLessThan(luma(ARENA_COLORS.stands[0]));
    expect(luma(ARENA_COLORS.stands[0])).toBeLessThan(luma(ARENA_COLORS.stands[1]));
    expect(luma(ARENA_COLORS.stands[1])).toBeLessThan(luma(ARENA_COLORS.platform));
    expect(luma(ARENA_COLORS.platform)).toBeLessThan(luma(ARENA_COLORS.rim));
  });

  it('decrit une salle embrasee plus claire que la salle au repos', () => {
    for (const key of ['ambientSky', 'key', 'back', 'rim', 'haze'] as const) {
      expect(luma(ARENA_MOOD.blaze[key])).toBeGreaterThan(luma(ARENA_MOOD.calm[key]));
    }
  });
});

describe('colorOf', () => {
  it('rend la teinte demandee', () => {
    expect(colorOf('#b36bff').getHexString()).toBe('b36bff');
  });

  it('memorise chaque teinte : la meme couleur est demandee a chaque image', () => {
    expect(colorOf('#ff4fa3')).toBe(colorOf('#ff4fa3'));
    expect(colorOf('#ff4fa3')).not.toBe(colorOf('#4fe3ff'));
  });

  it('rend une couleur figee, qu un appelant ne peut pas abimer', () => {
    const shared = colorOf('#ffcf3f');
    expect(() => shared.setRGB(0, 0, 0)).toThrow();
    expect(colorOf('#ffcf3f').getHexString()).toBe('ffcf3f');
  });
});

describe('withAlpha', () => {
  it('convertit un hexadecimal en rgba pour le calque 2D', () => {
    expect(withAlpha('#b36bff', 0.35)).toBe('rgba(179,107,255,0.35)');
    expect(withAlpha('#000000', 1)).toBe('rgba(0,0,0,1)');
  });

  it('refuse un hexadecimal mal forme', () => {
    expect(() => withAlpha('b36bff', 1)).toThrow(/hexadecimal/);
    expect(() => withAlpha('#b36b', 1)).toThrow(/hexadecimal/);
  });
});
