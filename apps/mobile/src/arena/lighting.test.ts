import { DirectionalLight, HemisphereLight } from 'three';
import { describe, expect, it } from 'vitest';
import { createLighting } from './lighting.js';
import { arenaMood } from './mood.js';

describe('createLighting', () => {
  it('reprend les trois lumieres du prototype', () => {
    const lighting = createLighting();
    expect(lighting.group.name).toBe('lighting');
    expect(lighting.group.children.map((c) => c.name)).toEqual(['ambient', 'key', 'back']);
    expect(lighting.ambient).toBeInstanceOf(HemisphereLight);
    expect(lighting.key).toBeInstanceOf(DirectionalLight);
    expect(lighting.back).toBeInstanceOf(DirectionalLight);
  });

  it('pose la lumiere principale devant a droite', () => {
    expect(createLighting().key.position.toArray()).toEqual([2.5, 4, 5]);
  });

  /**
   * Le contre-jour doit passer **sous** la ligne des epaules pour poser un
   * liseré sur la nuque et le haut des bras. Pose plus haut que la principale,
   * il n eclaire que le sol et les combattants restent des taches sombres.
   */
  it('pose le contre-jour bas et derriere', () => {
    const { key, back } = createLighting();
    expect(back.position.z).toBeLessThan(0);
    expect(back.position.y).toBeLessThan(key.position.y);
  });

  it('part de la salle au repos', () => {
    const { key, ambient } = createLighting();
    const calm = arenaMood(0);
    expect(key.intensity).toBeCloseTo(calm.keyIntensity, 6);
    expect(ambient.intensity).toBeCloseTo(calm.ambientIntensity, 6);
  });

  it('fait basculer la dominante avec la ferveur', () => {
    const lighting = createLighting();
    lighting.update(0);
    const calm = lighting.key.color.getHexString();
    const calmBack = lighting.back.intensity;

    lighting.update(1);
    expect(lighting.key.color.getHexString()).not.toBe(calm);
    expect(lighting.back.intensity).toBeGreaterThan(calmBack);
    expect(lighting.key.intensity).toBeCloseTo(arenaMood(1).keyIntensity, 6);
  });

  it('borne la ferveur a 1', () => {
    const lighting = createLighting();
    lighting.update(1);
    const at1 = lighting.key.color.getHexString();
    lighting.update(9);
    expect(lighting.key.color.getHexString()).toBe(at1);
  });

  it('se detache de la scene quand on la libere', () => {
    const lighting = createLighting();
    lighting.dispose();
    expect(lighting.group.children).toHaveLength(0);
  });
});
