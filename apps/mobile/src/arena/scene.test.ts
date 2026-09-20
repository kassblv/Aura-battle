import { type Color, Fog, Texture } from 'three';
import { describe, expect, it, vi } from 'vitest';
import { wideFraming } from './camera.js';
import { createArenaScene } from './scene.js';

function makeScene() {
  const grid = new Texture();
  const glow = new Texture();
  return { arena: createArenaScene({ textures: { grid, glow }, rng: () => 0.5 }), grid, glow };
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
      'aura-glow',
      'aura-glow',
      'particles',
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
    const { arena, grid, glow } = makeScene();
    const gridSpy = vi.spyOn(grid, 'dispose');
    const glowSpy = vi.spyOn(glow, 'dispose');
    const stageSpy = vi.spyOn(arena.stage, 'dispose');

    arena.dispose();

    expect(stageSpy).toHaveBeenCalledOnce();
    expect(gridSpy).toHaveBeenCalledOnce();
    expect(glowSpy).toHaveBeenCalledOnce();
    expect(arena.scene.children).toHaveLength(0);
  });

  it('supporte une double liberation', () => {
    const { arena } = makeScene();
    arena.dispose();
    expect(() => arena.dispose()).not.toThrow();
  });
});

describe('auras', () => {
  const frame = (elapsed: number) => ({
    elapsed,
    delta: 1 / 60,
    framing: wideFraming(),
    hype: 0.5,
    shake: 0,
    reducedMotion: false,
  });

  function burn(arena: ReturnType<typeof createArenaScene>, seconds: number): void {
    for (let i = 0; i < seconds * 60; i++) arena.update(frame(i / 60));
  }

  it('joue l effet demande et retombe sur la Lueur si on l ignore', () => {
    const { arena } = makeScene();
    arena.setAura('a', { effectId: 'fx.galaxy', color: '#b36bff', intensity: 1 });
    arena.setAura('b', { effectId: 'fx.inexistant', color: '#4fe3ff', intensity: 1 });
    expect(arena.auras.a.style.id).toBe('fx.galaxy');
    expect(arena.auras.b.style.id).toBe('fx.glow');
    arena.dispose();
  });

  it('remplit le puits a particules pendant que l arene tourne', () => {
    const { arena } = makeScene();
    arena.setAura('a', { effectId: 'fx.flames', color: '#ff3b3b', intensity: 1 });
    arena.setAura('b', { effectId: 'fx.vortex', color: '#4fe3ff', intensity: 1 });
    burn(arena, 2);
    expect(arena.particles.counts.additive).toBeGreaterThan(50);
    expect(arena.particles.counts.additive).toBeLessThanOrEqual(2400);
    arena.dispose();
  });

  /**
   * Hors match, le siege de droite est cache.
   *
   * Sans cette coupure, l accueil montre l aura d un adversaire absent,
   * flottant a un metre cinquante du joueur.
   */
  it('n emet rien pour un combattant cache', () => {
    const { arena } = makeScene();
    arena.fighters.b.root.visible = false;
    arena.setAura('a', { effectId: 'fx.sparks', color: '#ffcf3f', intensity: 1 });
    arena.setAura('b', { effectId: 'fx.flames', color: '#ff3b3b', intensity: 1 });
    burn(arena, 2);
    expect(arena.auras.b.particleCount).toBe(0);
    expect(arena.auras.a.particleCount).toBeGreaterThan(0);
    arena.dispose();
  });

  it('accroche l aura au combattant, pas au centre de l arene', () => {
    const { arena } = makeScene();
    arena.setAura('a', { effectId: 'fx.vortex', color: '#ffcf3f', intensity: 1 });
    burn(arena, 2);
    const glow = arena.scene.children.filter((c) => c.name === 'aura-glow');
    expect(glow[0]?.getObjectByName('aura-halo')?.position.x).toBeCloseTo(
      arena.fighters.a.root.position.x,
      6,
    );
    arena.dispose();
  });

  it('adapte la taille des points au format de la fenetre', () => {
    const { arena } = makeScene();
    const scaleOf = (): number => {
      const points = arena.particles.group.children[0] as unknown as {
        material: { uniforms: Record<string, { value: number }> };
      };
      return points.material.uniforms.uScale!.value;
    };
    arena.setSize(844, 390, 2);
    const small = scaleOf();
    arena.setSize(844, 780, 2);
    expect(scaleOf()).toBeCloseTo(small * 2, 6);
    arena.dispose();
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
