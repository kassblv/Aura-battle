import { PerspectiveCamera } from 'three';
import { describe, expect, it } from 'vitest';
import {
  METERS_PER_LOGIC_UNIT,
  measureViewport,
  projectLogicToScreen,
  toWorldX,
  toWorldY,
} from './coords.js';

const viewport = measureViewport(400, 660);

describe('measureViewport', () => {
  it('derive l echelle et le sol de la hauteur affichee, comme le prototype', () => {
    expect(viewport).toEqual({ width: 400, height: 660, scale: 2, groundY: 554.4 });
  });

  it('reste sain sur une fenetre de hauteur nulle', () => {
    expect(measureViewport(0, 0).scale).toBeGreaterThan(0);
  });
});

describe('conversion logique -> metres', () => {
  it('place le centre de l ecran a l origine du monde', () => {
    expect(toWorldX(200, viewport)).toBe(0);
    expect(toWorldY(viewport.groundY, viewport)).toBe(0);
  });

  it('convertit un pixel logique en metres a l echelle du prototype', () => {
    expect(toWorldX(400, viewport)).toBeCloseTo(1, 10);
    expect(toWorldY(viewport.groundY - 200, viewport)).toBeCloseTo(1, 10);
    expect(METERS_PER_LOGIC_UNIT).toBe(0.01);
  });

  it('compte vers le haut en 3D alors que l ecran compte vers le bas', () => {
    expect(toWorldY(viewport.groundY - 100, viewport)).toBeGreaterThan(0);
    expect(toWorldY(viewport.groundY + 100, viewport)).toBeLessThan(0);
  });
});

describe('projectLogicToScreen', () => {
  const camera = new PerspectiveCamera(40, 400 / 660, 0.1, 90);
  camera.position.set(0, 0, 5);
  camera.lookAt(0, 0, 0);
  camera.updateMatrixWorld();

  it('reprojette le centre du sol au centre de l ecran', () => {
    const p = projectLogicToScreen(camera, viewport, 200, viewport.groundY);
    expect(p.x).toBeCloseTo(200, 6);
    expect(p.y).toBeCloseTo(330, 6);
    expect(p.depth).toBeGreaterThan(0);
    expect(p.depth).toBeLessThan(1);
  });

  it('garde la droite a droite et le haut en haut', () => {
    const right = projectLogicToScreen(camera, viewport, 300, viewport.groundY);
    const above = projectLogicToScreen(camera, viewport, 200, viewport.groundY - 100);
    expect(right.x).toBeGreaterThan(200);
    expect(above.y).toBeLessThan(330);
  });

  it('signale par une profondeur > 1 ce qui passe derriere la camera', () => {
    const behind = projectLogicToScreen(camera, viewport, 200, viewport.groundY, 20);
    expect(behind.depth).toBeGreaterThan(1);
  });
});
