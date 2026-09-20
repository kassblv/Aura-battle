import type { Mesh, MeshBasicMaterial } from 'three';
import { describe, expect, it } from 'vitest';
import { CAMERA_FOV } from './camera.js';
import { createFlash, flashQuadSize } from './flash.js';

const materialOf = (mesh: Mesh): MeshBasicMaterial => mesh.material as MeshBasicMaterial;

describe('flashQuadSize', () => {
  /*
    Le champ de vision de Three.js est VERTICAL. Un voile dimensionne comme si
    le `fov` etait horizontal serait trop etroit en paysage — soit exactement le
    format du jeu — et laisserait deux bandes de decor visibles sur les cotes.
  */
  it('deduit la hauteur du champ vertical, et la largeur du rapport d image', () => {
    const [width, height] = flashQuadSize(1, 2, CAMERA_FOV);
    expect(height).toBeCloseTo(2 * Math.tan((CAMERA_FOV * Math.PI) / 360), 10);
    expect(width).toBeCloseTo(height * 2, 10);
  });

  it('couvre plus large a mesure que le cadre s elargit', () => {
    const narrow = flashQuadSize(1, 1);
    const wide = flashQuadSize(1, 2.16);
    expect(wide[0]).toBeGreaterThan(narrow[0]);
    expect(wide[1]).toBeCloseTo(narrow[1], 10);
  });

  it('survit a une fenetre repliee', () => {
    const [width, height] = flashQuadSize(1, 0);
    expect(width).toBeGreaterThan(0);
    expect(height).toBeGreaterThan(0);
  });
});

describe('createFlash', () => {
  it('reste invisible au repos : pas d appel de dessin quand rien ne flashe', () => {
    const flash = createFlash();
    expect(flash.mesh.visible).toBe(false);
    flash.set(0);
    expect(flash.mesh.visible).toBe(false);
  });

  it('s allume et se coupe avec la valeur demandee', () => {
    const flash = createFlash();
    flash.set(0.5);
    expect(flash.mesh.visible).toBe(true);
    expect(materialOf(flash.mesh).opacity).toBeCloseTo(0.5, 10);
    flash.set(0);
    expect(flash.mesh.visible).toBe(false);
  });

  it('borne l opacite', () => {
    const flash = createFlash();
    flash.set(4);
    expect(materialOf(flash.mesh).opacity).toBe(1);
    flash.set(-1);
    expect(materialOf(flash.mesh).opacity).toBe(0);
  });

  it('passe devant tout et ignore le brouillard de la salle', () => {
    const material = materialOf(createFlash().mesh);
    expect(material.depthTest).toBe(false);
    expect(material.depthWrite).toBe(false);
    expect(material.fog).toBe(false);
  });

  it('se redimensionne avec le cadre', () => {
    const flash = createFlash();
    flash.setAspect(2.16);
    const wide = flash.mesh.scale.x;
    flash.setAspect(1);
    expect(wide).toBeGreaterThan(flash.mesh.scale.x);
  });

  it('libere sa geometrie et son materiau', () => {
    const flash = createFlash();
    let disposed = 0;
    materialOf(flash.mesh).addEventListener('dispose', () => {
      disposed++;
    });
    flash.dispose();
    flash.dispose();
    expect(disposed).toBe(1);
  });
});
