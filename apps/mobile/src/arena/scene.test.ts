import { type Color, Fog, type InstancedMesh, Matrix4, Texture } from 'three';
import { describe, expect, it, vi } from 'vitest';
import { wideFraming } from './camera.js';
import { buildSeats } from './crowdLayout.js';
import { createArenaScene } from './scene.js';

function makeScene() {
  const textures = { floor: new Texture(), glow: new Texture(), haze: new Texture() };
  return { arena: createArenaScene({ textures, rng: () => 0.5 }), textures };
}

describe('createArenaScene', () => {
  it('peint le fond et le brouillard dans le violet nuit du prototype', () => {
    const { arena } = makeScene();
    expect((arena.scene.background as Color).getHexString()).toBe('0d0620');
    const fog = arena.scene.fog;
    expect(fog).toBeInstanceOf(Fog);
    // Le brouillard commence juste derriere les combattants : il efface les
    // gradins du fond et garde l attention au centre.
    expect((fog as Fog).near).toBeGreaterThan(4.7);
    expect((fog as Fog).far).toBeGreaterThan((fog as Fog).near);
    expect((fog as Fog).color.getHexString()).toBe('0d0620');
  });

  it('accroche l eclairage, le decor, le public et les deux combattants', () => {
    expect(makeScene().arena.scene.children.map((c) => c.name)).toEqual([
      'lighting',
      'stage',
      'crowd',
      'fighter',
      'fighter',
      // Deux tampons pour toutes les particules de l arene, et la camera, qui
      // entre dans le graphe parce qu elle porte le voile plein ecran.
      'particles',
      'camera',
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
    const { arena, textures } = makeScene();
    const spies = Object.values(textures).map((t) => vi.spyOn(t, 'dispose'));
    const stageSpy = vi.spyOn(arena.stage, 'dispose');

    arena.dispose();

    expect(stageSpy).toHaveBeenCalledOnce();
    for (const spy of spies) expect(spy).toHaveBeenCalledOnce();
    expect(arena.scene.children).toHaveLength(0);
  });

  /**
   * La lumiere suit la ferveur : c est ce qui distingue la recharge, ou il ne
   * se passe encore rien, du choc qui decide la manche.
   */
  it('fait basculer la lumiere avec la ferveur du public', () => {
    const { arena } = makeScene();
    const frame = {
      delta: 1 / 60,
      elapsed: 0,
      framing: wideFraming(),
      shake: 0,
      reducedMotion: true,
    };
    const lighting = arena.scene.getObjectByName('lighting');
    const key = lighting?.getObjectByName('key');
    if (key === undefined || !('intensity' in key)) throw new Error('eclairage absent');

    arena.update({ ...frame, hype: 0 });
    const calm = key.intensity as number;
    arena.update({ ...frame, hype: 1 });
    expect(key.intensity as number).toBeGreaterThan(calm);
  });

  /**
   * Hors match, un seul personnage est a l ecran et on tourne autour : le
   * premier cercle masquerait ce qu on vient inspecter.
   */
  it('retire le premier cercle quand l arene sert de vitrine', () => {
    const { arena } = makeScene();
    const frame = {
      delta: 1 / 60,
      elapsed: 0,
      framing: wideFraming(),
      shake: 0,
      hype: 0.3,
      reducedMotion: true,
    };
    const body = arena.crowd.group.children.find((c) => c.name === 'body');
    if (body === undefined || !('getMatrixAt' in body)) throw new Error('public absent');
    // L echelle se lit sur les colonnes : `decompose` rend 1 sur une matrice
    // d echelle nulle, et c est ainsi qu on efface une instance.
    const read = (index: number): number => {
      const matrix = new Matrix4();
      (body as InstancedMesh).getMatrixAt(index, matrix);
      const [xx = 0, xy = 0, xz = 0] = matrix.elements;
      return Math.hypot(xx, xy, xz);
    };
    const seats = buildSeats(() => 0.5);
    const ring = seats.findIndex((s) => s.ring);

    arena.update({ ...frame, showcase: false });
    expect(read(ring)).toBeGreaterThan(0);
    arena.update({ ...frame, elapsed: 0.1, showcase: true });
    expect(read(ring)).toBe(0);
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
