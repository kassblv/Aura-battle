import { describe, expect, it } from 'vitest';
import { contrastRatio, parseHex, relativeLuminance } from './color.js';

describe('parseHex', () => {
  it('lit une couleur a six chiffres', () => {
    expect(parseHex('#7a3cff')).toEqual([0x7a, 0x3c, 0xff]);
  });

  it('accepte la forme courte a trois chiffres', () => {
    expect(parseHex('#fff')).toEqual([255, 255, 255]);
  });

  it('refuse ce qui n est pas une couleur', () => {
    expect(() => parseHex('violet')).toThrow(/couleur/i);
    expect(() => parseHex('#12345')).toThrow(/couleur/i);
  });
});

describe('relativeLuminance', () => {
  it('rend 0 pour le noir et 1 pour le blanc', () => {
    expect(relativeLuminance('#000000')).toBeCloseTo(0, 6);
    expect(relativeLuminance('#ffffff')).toBeCloseTo(1, 6);
  });
});

describe('contrastRatio', () => {
  /**
   * Valeurs de reference de WCAG 2.1. Sans elles, ce module pourrait rendre
   * des nombres plausibles et faux, et tous les tests de palette qui s'appuient
   * dessus passeraient en mesurant n'importe quoi.
   */
  it('rend 21 entre le noir et le blanc', () => {
    expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 4);
  });

  it('rend 1 entre une couleur et elle-meme', () => {
    expect(contrastRatio('#7a3cff', '#7a3cff')).toBeCloseTo(1, 6);
  });

  it('est symetrique : l ordre des couleurs ne change rien', () => {
    expect(contrastRatio('#efe8ff', '#1e1240')).toBeCloseTo(contrastRatio('#1e1240', '#efe8ff'), 6);
  });

  it('applique bien la correction gamma de sRGB', () => {
    // Le gris moyen n'est pas a mi-chemin en luminance : c'est tout l'objet de
    // la correction. Une moyenne naive donnerait 2,55 des deux cotes.
    expect(contrastRatio('#808080', '#ffffff')).toBeCloseTo(3.95, 2);
  });
});
