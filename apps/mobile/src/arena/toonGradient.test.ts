import { NearestFilter, NoColorSpace, RedFormat, UnsignedByteType } from 'three';
import { describe, expect, it } from 'vitest';
import { TOON_GRADIENT_STEPS, createToonGradientMap } from './toonGradient.js';

describe('createToonGradientMap', () => {
  it('garde les trois paliers du prototype', () => {
    expect(Array.from(TOON_GRADIENT_STEPS)).toEqual([80, 160, 255]);
    const map = createToonGradientMap();
    expect(Array.from(map.image.data as Uint8Array)).toEqual([80, 160, 255]);
    expect(map.image.width).toBe(3);
    expect(map.image.height).toBe(1);
  });

  // Piege connu (CLAUDE.md) : le prototype tourne sur r128 et utilise
  // LuminanceFormat, retire depuis. RedFormat donne le meme canal unique.
  it('utilise RedFormat, LuminanceFormat ayant disparu depuis r128', () => {
    const map = createToonGradientMap();
    expect(map.format).toBe(RedFormat);
    expect(map.type).toBe(UnsignedByteType);
  });

  // Exige par la doc de MeshToonMaterial.gradientMap : un degrade interpole
  // n est plus un rendu toon.
  it('coupe le filtrage : le degrade toon doit rester en marches', () => {
    const map = createToonGradientMap();
    expect(map.minFilter).toBe(NearestFilter);
    expect(map.magFilter).toBe(NearestFilter);
    expect(map.generateMipmaps).toBe(false);
  });

  // Ce degrade est une donnee, pas une couleur : le convertir en sRGB
  // deplacerait les paliers.
  it('reste hors de toute gestion de couleur', () => {
    expect(createToonGradientMap().colorSpace).toBe(NoColorSpace);
  });

  it('se declare a televerser', () => {
    expect(createToonGradientMap().version).toBeGreaterThan(0);
  });

  it('rend une texture par appel : chaque scene possede la sienne', () => {
    expect(createToonGradientMap()).not.toBe(createToonGradientMap());
  });
});
