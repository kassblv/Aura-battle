import { type Color, Fog, InstancedMesh, Matrix4, Texture } from 'three';
import { describe, expect, it, vi } from 'vitest';
import { wideFraming } from './camera.js';
import { buildSeats } from './crowdLayout.js';
import { QUALITY_PROFILES } from '../platform/quality.js';
import type { AuraEmitter } from './aura.js';
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
      // Le voile et la tache au sol de chaque aura. Ce sont les SEULS noeuds
      // d une aura : ses particules partent dans le puits commun.
      'aura-glow',
      'aura-glow',
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

describe('palier de qualite', () => {
  /*
    La scene ne decide rien : `platform/quality.ts` choisit le palier, la
    scene le pose sur les trois leviers qu elle detient. Le quatrieme — le
    rapport de pixels — appartient au rendu, qui vit au-dessus.
  */
  it('pose le palier sur la foule, les particules et les mains', () => {
    const { arena } = makeScene();
    arena.applyQuality(QUALITY_PROFILES.smooth);

    const body = arena.crowd.group.children.find(
      (child): child is InstancedMesh => child instanceof InstancedMesh && child.name === 'body',
    );
    if (body === undefined) throw new Error('foule absente');
    expect(body.count).toBe(QUALITY_PROFILES.smooth.crowdSeats);

    arena.particles.begin();
    for (let i = 0; i < QUALITY_PROFILES.rich.additiveParticles; i++) {
      arena.particles.add(0, 0, 0, '#ffffff', 1, 1);
    }
    expect(arena.particles.counts.additive).toBe(QUALITY_PROFILES.smooth.additiveParticles);

    for (const seat of ['a', 'b'] as const) {
      expect(arena.fighters[seat].hands.every((hand) => hand.group.visible)).toBe(false);
    }
    arena.dispose();
  });

  it('remet tout en place quand le palier remonte', () => {
    const { arena } = makeScene();
    arena.applyQuality(QUALITY_PROFILES.smooth);
    arena.applyQuality(QUALITY_PROFILES.rich);

    const body = arena.crowd.group.children.find(
      (child): child is InstancedMesh => child instanceof InstancedMesh && child.name === 'body',
    );
    if (body === undefined) throw new Error('foule absente');
    expect(body.count).toBe(QUALITY_PROFILES.rich.crowdSeats);
    expect(arena.fighters.a.hands.every((hand) => hand.group.visible)).toBe(true);
    arena.dispose();
  });
});

describe('auras des combattants', () => {
  it('donne une aura a chaque siege, accrochee a la scene', () => {
    const { arena } = makeScene();
    expect(Object.keys(arena.auras)).toEqual(['a', 'b']);
    const glows = arena.scene.children.filter((child) => child.name === 'aura-glow');
    expect(glows).toHaveLength(2);
    arena.dispose();
  });

  /*
    Le palier de qualite baisse le nombre de particules VIVANTES, pas seulement
    celles qu on ecrit : laisser le tampon tronquer afficherait la meme chose,
    mais on paierait la naissance et le deplacement de ce qui est jete.
  */
  /*
    La Galaxie, et pas le style de repli.

    Mesure a la main : au regime, la Lueur se stabilise a 37 particules et la
    Galaxie a 143. Un test ecrit sur la Lueur passerait quel que soit le
    budget — il ne verifierait rien. Seul un style qui SATURE le plafond peut
    dire si le plafond existe.
  */
  const saturating = { effectId: 'fx.galaxy', color: '#b36bff', intensity: 1 } as const;

  function settle(aura: AuraEmitter): void {
    aura.set(saturating);
    for (let i = 0; i < 900; i++) aura.update(1 / 60);
  }

  it('fait suivre le budget d aura au palier', () => {
    const { arena } = makeScene();
    arena.applyQuality(QUALITY_PROFILES.smooth);
    for (const seat of ['a', 'b'] as const) {
      settle(arena.auras[seat]);
      expect(arena.auras[seat].particleCount).toBeLessThanOrEqual(
        QUALITY_PROFILES.smooth.auraParticles,
      );
    }
    arena.dispose();
  });

  it('remonte le budget avec le palier', () => {
    const { arena } = makeScene();
    arena.applyQuality(QUALITY_PROFILES.smooth);
    arena.applyQuality(QUALITY_PROFILES.rich);
    settle(arena.auras.a);
    expect(arena.auras.a.particleCount).toBeGreaterThan(QUALITY_PROFILES.smooth.auraParticles);
    arena.dispose();
  });
});

describe('aura d un combattant masque', () => {
  /*
    Hors match un seul combattant est a l ecran : `useArena` rend l autre
    invisible. Mais une aura ne passe pas par le noeud du combattant — ses
    particules vont dans le puits commun, et son voile est un groupe a part.
    Sans cette regle, l accueil affiche une gerbe doree qui flotte a un metre
    et demi du personnage, autour de quelqu un qu on ne voit pas. Vu a
    l ecran, pas dans un test.
  */
  function drawnXs(arena: ReturnType<typeof createArenaScene>): number[] {
    const xs: number[] = [];
    arena.drawAuras(
      {
        add: (x) => xs.push(x),
        dark: (x) => xs.push(x),
      },
      1,
    );
    return xs;
  }

  function charge(arena: ReturnType<typeof createArenaScene>): void {
    for (const seat of ['a', 'b'] as const) {
      arena.auras[seat].set({ effectId: 'fx.galaxy', color: '#b36bff', intensity: 1 });
    }
    for (let i = 0; i < 300; i++) {
      arena.update({
        elapsed: i / 60,
        delta: 1 / 60,
        framing: wideFraming(),
        hype: 1,
        shake: 0,
        reducedMotion: false,
      });
    }
  }

  it('dessine les deux auras quand les deux combattants sont la', () => {
    const { arena } = makeScene();
    charge(arena);
    const xs = drawnXs(arena);
    expect(xs.filter((x) => x < 0).length).toBeGreaterThan(0);
    expect(xs.filter((x) => x > 0).length).toBeGreaterThan(0);
    arena.dispose();
  });

  it('ne dessine rien autour d un combattant invisible', () => {
    const { arena } = makeScene();
    charge(arena);
    arena.fighters.b.root.visible = false;
    const xs = drawnXs(arena);
    expect(xs.filter((x) => x < 0).length).toBeGreaterThan(0);
    expect(xs.filter((x) => x > 0)).toHaveLength(0);
    arena.dispose();
  });

  it('eteint aussi le voile du combattant invisible', () => {
    const { arena } = makeScene();
    arena.fighters.b.root.visible = false;
    charge(arena);
    const glows = arena.scene.children.filter((child) => child.name === 'aura-glow');
    expect(glows.map((g) => g.visible)).toEqual([true, false]);
    arena.dispose();
  });
});
