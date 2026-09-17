import { describe, expect, it } from 'vitest';
import { ARENA_COLORS, colorOf, withAlpha } from './palette.js';

describe('palette de l arene', () => {
  it('reprend les couleurs du prototype', () => {
    expect(ARENA_COLORS.background).toBe('#120a28');
    expect(ARENA_COLORS.ground).toBe('#170d35');
    expect(ARENA_COLORS.platform).toBe('#1f114a');
    expect(ARENA_COLORS.rim).toBe('#b36bff');
    expect(ARENA_COLORS.stands).toEqual(['#201244', '#261550']);
    expect(ARENA_COLORS.strips).toEqual(['#4fe3ff', '#ff4fa3']);
    expect(ARENA_COLORS.sweeps).toEqual(['#b36bff', '#4fe3ff', '#ff4fa3', '#ffcf3f']);
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
