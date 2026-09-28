import { Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import {
  ArenaCameraRig,
  createArenaCamera,
  distanceForZoom,
  focusFraming,
  soloFraming,
  wideFraming,
} from './camera.js';
import type { ArenaCameraInput } from './camera.js';

function settle(rig: ArenaCameraRig, input: Omit<ArenaCameraInput, 'delta'>, steps = 900): void {
  for (let i = 0; i < steps; i++) {
    rig.update({ ...input, delta: 1 / 60 });
  }
}

describe('createArenaCamera', () => {
  it('reprend l objectif et la position de repos du prototype', () => {
    const camera = createArenaCamera(400 / 660);
    expect(camera.fov).toBe(40);
    expect(camera.near).toBeCloseTo(0.1, 6);
    expect(camera.far).toBe(90);
    expect(camera.aspect).toBeCloseTo(400 / 660, 6);
    expect(camera.position.toArray()).toEqual([0, 1.4, 4.7]);
  });
});

describe('cadrages', () => {
  it('cadre large pendant le match', () => {
    expect(wideFraming()).toEqual({ lookX: 0, lookY: 0.85, distance: 4.7, orbit: 0 });
  });

  it('se rapproche hors match, centre sur le joueur', () => {
    expect(soloFraming(0.4)).toEqual({ lookX: 0.4, lookY: 0.8, distance: 3.7, orbit: 0 });
  });

  it('ecrase la cible vers le centre quand on suit un combattant', () => {
    const framing = focusFraming({ worldX: 1, worldY: 0.9, facing: -1, zoom: 1.16 });
    expect(framing.lookX).toBeCloseTo(0.8, 10);
    expect(framing.lookY).toBeCloseTo(0.91, 10);
    expect(framing.orbit).toBeCloseTo(-0.07, 10);
  });

  it('traduit le zoom en distance, sans jamais entrer dans le combattant', () => {
    expect(distanceForZoom(1)).toBeCloseTo(4.7, 10);
    expect(distanceForZoom(1.16)).toBeCloseTo(2.94, 10);
    expect(distanceForZoom(1.12)).toBeCloseTo(3.38, 10);
    expect(distanceForZoom(5)).toBeCloseTo(2.6, 10);
  });
});

describe('ArenaCameraRig', () => {
  const still = { framing: wideFraming(), elapsed: 0, shake: 0, reducedMotion: true };

  it('converge vers la position de repos', () => {
    const camera = createArenaCamera(1);
    const rig = new ArenaCameraRig(camera);
    settle(rig, still);
    expect(camera.position.x).toBeCloseTo(0, 5);
    expect(camera.position.y).toBeCloseTo(0.55 + 0.85 * 0.95, 5);
    expect(camera.position.z).toBeCloseTo(4.7, 5);
  });

  it('avance vers la cible sans y sauter : le premier pas ne fait qu une fraction du chemin', () => {
    const camera = createArenaCamera(1);
    const rig = new ArenaCameraRig(camera);
    rig.update({ ...still, framing: soloFraming(1), delta: 1 / 60 });
    expect(camera.position.z).toBeGreaterThan(4.6);
    expect(camera.position.z).toBeLessThan(4.7);
  });

  it('se rapproche quand on suit un combattant', () => {
    const wide = createArenaCamera(1);
    const close = createArenaCamera(1);
    settle(new ArenaCameraRig(wide), still);
    settle(new ArenaCameraRig(close), {
      ...still,
      framing: focusFraming({ worldX: 0, worldY: 0.85, facing: 0, zoom: 1.16 }),
    });
    expect(close.position.z).toBeLessThan(wide.position.z);
    expect(close.position.z).toBeCloseTo(2.94, 4);
  });

  it('fait osciller lentement l orbite quand le mouvement est autorise', () => {
    const camera = createArenaCamera(1);
    // sin(12 * .13) vaut presque 1 : l oscillation est a son maximum.
    settle(new ArenaCameraRig(camera), { ...still, elapsed: 12, reducedMotion: false });
    expect(camera.position.x).toBeCloseTo(Math.sin(0.1) * 4.7, 4);
    expect(camera.position.z).toBeCloseTo(Math.cos(0.1) * 4.7, 4);
  });

  it('secoue la camera proportionnellement au choc', () => {
    const calm = createArenaCamera(1);
    const hit = createArenaCamera(1);
    const input = { ...still, elapsed: 3.2, reducedMotion: false };
    settle(new ArenaCameraRig(calm), input);
    settle(new ArenaCameraRig(hit), { ...input, shake: 14 });
    const dx = Math.abs(hit.position.x - calm.position.x);
    expect(dx).toBeGreaterThan(0.001);
    expect(dx).toBeLessThanOrEqual(14 * 0.004);
  });

  it('ne secoue jamais quand l utilisateur demande moins d animation', () => {
    const calm = createArenaCamera(1);
    const hit = createArenaCamera(1);
    settle(new ArenaCameraRig(calm), { ...still, elapsed: 3.2 });
    settle(new ArenaCameraRig(hit), { ...still, elapsed: 3.2, shake: 14 });
    expect(hit.position.toArray()).toEqual(calm.position.toArray());
  });

  it('vise le point de cadrage, pas l origine', () => {
    const camera = createArenaCamera(1);
    settle(new ArenaCameraRig(camera), { ...still, framing: soloFraming(0.5) });
    const aim = new Vector3(0.5, 0.8, 0).sub(camera.position).normalize();
    const forward = camera.getWorldDirection(new Vector3());
    expect(forward.x).toBeCloseTo(aim.x, 5);
    expect(forward.y).toBeCloseTo(aim.y, 5);
    expect(forward.z).toBeCloseTo(aim.z, 5);
  });
});
