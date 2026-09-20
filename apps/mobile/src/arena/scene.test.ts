import { type Color, Fog, Texture } from 'three';
import { describe, expect, it, vi } from 'vitest';
import { wideFraming } from './camera.js';
import { createArenaScene } from './scene.js';

function makeScene() {
  const grid = new Texture();
  return { arena: createArenaScene({ textures: { grid }, rng: () => 0.5 }), grid };
}

describe('createArenaScene', () => {
  it('peint le fond et le brouillard dans le violet nuit du prototype', () => {
    const { arena } = makeScene();
    expect((arena.scene.background as Color).getHexString()).toBe('120a28');
    const fog = arena.scene.fog;
    expect(fog).toBeInstanceOf(Fog);
    expect((fog as Fog).near).toBe(7);
    expect((fog as Fog).far).toBe(19);
    expect((fog as Fog).color.getHexString()).toBe('120a28');
  });

  it('accroche l eclairage, le decor, le public et les deux combattants', () => {
    expect(makeScene().arena.scene.children.map((c) => c.name)).toEqual([
      'lighting',
      'stage',
      'crowd',
      'fighter',
      'fighter',
    ]);
  });

  it('place les combattants de part et d autre, tournes l un vers l autre', () => {
    const { arena } = makeScene();
    expect(arena.fighters.a.root.position.x).toBeLessThan(0);
    expect(arena.fighters.b.root.position.x).toBeGreaterThan(0);
    // Le siege de droite est retourne : sans cela les deux se regardent dans la
    // meme direction et le duel n en est plus un.
    expect(arena.fighters.b.placement.facing).toBe(-1);
    expect(arena.fighters.a.placement.facing).toBe(1);
  });

  it('anime le public au rythme des images', () => {
    const { arena } = makeScene();
    const frame = {
      delta: 1 / 60,
      framing: { lookX: 0, lookY: 0.8, distance: 4, orbit: 0 },
      shake: 0,
      reducedMotion: true,
    };
    const body = arena.crowd.group.children.find((c) => c.name === 'body');
    if (body === undefined || !('instanceMatrix' in body)) throw new Error('public absent');
    const attribute = body.instanceMatrix as { version: number };

    arena.update({ ...frame, elapsed: 0, hype: 0 });
    const version = attribute.version;
    arena.update({ ...frame, elapsed: 0.5, hype: 1 });
    expect(attribute.version).toBeGreaterThan(version);
  });

  it('suit le format de la fenetre', () => {
    const { arena } = makeScene();
    arena.setSize(400, 660);
    expect(arena.camera.aspect).toBeCloseTo(400 / 660, 10);
    expect(arena.viewport).toEqual({ width: 400, height: 660, scale: 2, groundY: 554.4 });
  });

  it('ne divise pas par zero quand la fenetre est repliee', () => {
    const { arena } = makeScene();
    expect(() => arena.setSize(0, 0)).not.toThrow();
    expect(Number.isFinite(arena.camera.aspect)).toBe(true);
  });

  it('anime le decor et la camera au rythme des images', () => {
    const { arena } = makeScene();
    const before = arena.camera.position.clone();
    for (let i = 0; i < 60; i++) {
      arena.update({
        elapsed: i / 60,
        delta: 1 / 60,
        framing: { lookX: 1, lookY: 0.8, distance: 3, orbit: 0 },
        hype: 1,
        shake: 0,
        reducedMotion: true,
      });
    }
    expect(arena.camera.position.distanceTo(before)).toBeGreaterThan(0.1);
    expect(arena.stage.group.getObjectByName('sweeps')?.children[0]?.rotation.x).not.toBe(0);
  });

  it('libere tout ce qu elle detient, textures comprises', () => {
    const { arena, grid } = makeScene();
    const gridSpy = vi.spyOn(grid, 'dispose');
    const stageSpy = vi.spyOn(arena.stage, 'dispose');

    arena.dispose();

    expect(stageSpy).toHaveBeenCalledOnce();
    expect(gridSpy).toHaveBeenCalledOnce();
    expect(arena.scene.children).toHaveLength(0);
  });

  it('supporte une double liberation', () => {
    const { arena } = makeScene();
    arena.dispose();
    expect(() => arena.dispose()).not.toThrow();
  });
});

describe('cadrage par defaut', () => {
  it('part du cadrage large', () => {
    const { arena } = makeScene();
    arena.update({
      elapsed: 0,
      delta: 1 / 60,
      framing: wideFraming(),
      hype: 0,
      shake: 0,
      reducedMotion: true,
    });
    expect(arena.camera.position.z).toBeCloseTo(4.7, 2);
  });
});
