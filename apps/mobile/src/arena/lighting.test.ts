import { DirectionalLight, HemisphereLight } from 'three';
import { describe, expect, it } from 'vitest';
import { createLighting } from './lighting.js';

describe('createLighting', () => {
  it('reprend les trois lumieres du prototype', () => {
    const lighting = createLighting();
    expect(lighting.group.name).toBe('lighting');
    expect(lighting.group.children.map((c) => c.name)).toEqual(['ambient', 'key', 'back']);
  });

  it('teinte l ambiance violet-ciel sur violet-sol', () => {
    const { ambient } = createLighting();
    expect(ambient).toBeInstanceOf(HemisphereLight);
    expect(ambient.color.getHexString()).toBe('a48cff');
    expect(ambient.groundColor.getHexString()).toBe('1a0c33');
    expect(ambient.intensity).toBeCloseTo(0.85, 6);
  });

  it('pose la lumiere principale devant a droite', () => {
    const { key } = createLighting();
    expect(key).toBeInstanceOf(DirectionalLight);
    expect(key.color.getHexString()).toBe('ffffff');
    expect(key.intensity).toBeCloseTo(0.75, 6);
    expect(key.position.toArray()).toEqual([2.5, 4, 5]);
  });

  it('pose le contre-jour violet derriere a gauche, pour detourer les combattants', () => {
    const { back } = createLighting();
    expect(back.color.getHexString()).toBe('9a6bff');
    expect(back.intensity).toBeCloseTo(0.8, 6);
    expect(back.position.toArray()).toEqual([-3, 3, -5]);
  });

  it('se detache de la scene quand on la libere', () => {
    const lighting = createLighting();
    lighting.dispose();
    expect(lighting.group.children).toHaveLength(0);
  });
});
