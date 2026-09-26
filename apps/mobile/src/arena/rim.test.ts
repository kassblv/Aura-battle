import {
  type Color,
  MeshToonMaterial,
  ShaderLib,
  type WebGLProgramParametersWithUniforms,
} from 'three';
import { describe, expect, it } from 'vitest';
import { createRimUniforms, injectRim, withRim } from './rim.js';

const TOON_FRAGMENT = ShaderLib.toon?.fragmentShader ?? '';
const TOON_VERTEX = ShaderLib.toon?.vertexShader ?? '';

/** Ce que Three.js passe a `onBeforeCompile`, reduit a ce que le liseré touche. */
function toonShader(): WebGLProgramParametersWithUniforms {
  return {
    uniforms: {},
    fragmentShader: TOON_FRAGMENT,
    vertexShader: TOON_VERTEX,
  } as unknown as WebGLProgramParametersWithUniforms;
}

describe('liseré', () => {
  /*
    Le jour ou Three.js renomme la sortie opaque — il l a deja fait une fois,
    `output_fragment` en r154 — l injection ne trouverait plus sa place. Ce
    test lit le VRAI programme toon de la version installee.
  */
  it('trouve sa place dans le programme toon de la version installee', () => {
    expect(TOON_FRAGMENT).not.toBe('');
    const injected = injectRim(TOON_FRAGMENT);
    const rim = injected.indexOf('outgoingLight += rimColor');
    expect(rim).toBeGreaterThan(-1);
    expect(rim).toBeLessThan(injected.indexOf('#include <opaque_fragment>'));
    // Apres le calcul de la lumiere, sinon il n y a rien a quoi s ajouter.
    expect(rim).toBeGreaterThan(injected.indexOf('vec3 outgoingLight'));
  });

  it('echoue bruyamment plutot que de disparaitre en silence', () => {
    expect(() => injectRim('void main() {}')).toThrow();
  });

  it('branche les uniformes partages et separe le programme du decor', () => {
    const uniforms = createRimUniforms('#ffcf3f', 0.3);
    const one = new MeshToonMaterial();
    const two = new MeshToonMaterial();
    withRim(one, uniforms, 'fighter-rim');
    withRim(two, uniforms, 'fighter-rim');

    const shader = toonShader();
    one.onBeforeCompile(shader, undefined as never);
    expect(shader.uniforms.rimColor).toBe(uniforms.rimColor);
    expect(shader.uniforms.rimStrength).toBe(uniforms.rimStrength);
    expect(shader.fragmentShader).toContain('uniform vec3 rimColor;');

    // Un seul programme pour tous les materiaux d un porteur…
    expect(one.customProgramCacheKey()).toBe(two.customProgramCacheKey());
    // …et jamais celui d un materiau toon ordinaire.
    expect(one.customProgramCacheKey()).not.toBe(new MeshToonMaterial().customProgramCacheKey());

    // Repeindre l aura repeint le liseré de tous ses materiaux a la fois.
    uniforms.rimColor.value.set('#4fe3ff');
    expect((shader.uniforms.rimColor?.value as Color).getHexString()).toBe('4fe3ff');
    one.dispose();
    two.dispose();
  });
});
