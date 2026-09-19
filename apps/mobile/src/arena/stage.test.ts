import {
  type CircleGeometry,
  type CylinderGeometry,
  type Group,
  type Mesh,
  type Material,
  type Points,
  type RingGeometry,
  SRGBColorSpace,
  Texture,
  type TorusGeometry,
} from 'three';
import { describe, expect, it, vi } from 'vitest';
import { STAR_COUNT, createStage } from './stage.js';

function makeStage(rng: () => number = () => 0.5) {
  const gradientMap = new Texture();
  const gridTexture = new Texture();
  return { stage: createStage({ gradientMap, gridTexture }, rng), gradientMap, gridTexture };
}

function child<T>(group: Group, name: string): T {
  const found = group.getObjectByName(name);
  if (!found) throw new Error(`objet "${name}" absent de la scene`);
  return found as T;
}

describe('createStage — decor', () => {
  it('assemble le decor sous un seul groupe, pour pouvoir le demonter', () => {
    const { stage } = makeStage();
    expect(stage.group.name).toBe('stage');
    expect(stage.group.children.map((c) => c.name)).toEqual([
      'ground',
      'platform',
      'platform-top',
      'rim',
      'stands',
      'sweeps',
      'stars',
    ]);
  });

  it('pose un sol plat bien plus large que la plateforme', () => {
    const ground = child<Mesh<CircleGeometry>>(makeStage().stage.group, 'ground');
    expect(ground.geometry.parameters.radius).toBe(26);
    expect(ground.rotation.x).toBeCloseTo(-Math.PI / 2, 10);
    expect(ground.position.y).toBeCloseTo(-0.45, 10);
  });

  it('pose la plateforme legerement evasee vers le bas', () => {
    const plat = child<Mesh<CylinderGeometry>>(makeStage().stage.group, 'platform');
    expect(plat.geometry.parameters.radiusTop).toBeCloseTo(2.6, 10);
    expect(plat.geometry.parameters.radiusBottom).toBeCloseTo(2.8, 10);
    expect(plat.geometry.parameters.height).toBeCloseTo(0.45, 10);
    expect(plat.position.y).toBeCloseTo(-0.225, 10);
  });

  it('applique la grille fournie sur le dessus de la plateforme', () => {
    const { stage, gridTexture } = makeStage();
    const top = child<Mesh<CircleGeometry, Material & { map: Texture | null }>>(
      stage.group,
      'platform-top',
    );
    expect(top.material.map).toBe(gridTexture);
    expect(top.material.transparent).toBe(true);
    expect(top.position.y).toBeGreaterThan(0);
  });

  it('cercle la plateforme d un liseré lumineux', () => {
    const rim = child<Mesh<TorusGeometry>>(makeStage().stage.group, 'rim');
    expect(rim.geometry.parameters.radius).toBeCloseTo(2.62, 10);
    expect(rim.rotation.x).toBeCloseTo(Math.PI / 2, 10);
  });

  it('empile quatre gradins qui montent en s eloignant', () => {
    const stands = child<Group>(makeStage().stage.group, 'stands');
    expect(stands.children.map((c) => c.name)).toEqual(['tier-0', 'tier-1', 'tier-2', 'tier-3']);
    stands.children.forEach((tier, i) => {
      expect(tier.children.map((c) => c.name)).toEqual(['step', 'wall', 'strip']);
      const step = child<Mesh<RingGeometry>>(tier as Group, 'step');
      expect(step.geometry.parameters.innerRadius).toBeCloseTo(4.2 + i * 0.9, 10);
      expect(step.position.y).toBeCloseTo(-0.45 + (i + 1) * 0.42, 10);
    });
  });

  it('accroche quatre projecteurs au-dessus et derriere la scene', () => {
    const sweeps = child<Group>(makeStage().stage.group, 'sweeps');
    expect(sweeps.children).toHaveLength(4);
    sweeps.children.forEach((piv, i) => {
      expect(piv.position.toArray()).toEqual([-4.5 + i * 3, 6.2, -3.8]);
    });
  });

  it('seme un ciel etoile deterministe pour un tirage donne', () => {
    const points = child<Points>(makeStage().stage.group, 'stars');
    const pos = points.geometry.getAttribute('position');
    expect(pos.count).toBe(STAR_COUNT);
    // Les positions sont stockees en Float32 : on compare au millionieme.
    const th = Math.PI;
    const ph = 0.1 + 0.5 * 1.2;
    expect(pos.getX(0)).toBeCloseTo(45 * Math.cos(th) * Math.cos(ph), 4);
    expect(pos.getY(0)).toBeCloseTo(45 * Math.sin(ph) - 3, 4);
    expect(pos.getX(499)).toBeCloseTo(pos.getX(0), 10);
  });
});

describe('createStage — animation', () => {
  it('blanchit le liseré quand la ferveur monte', () => {
    const { stage } = makeStage();
    const read = () => stage.rim.material.color.getRGB({ r: 0, g: 0, b: 0 }, SRGBColorSpace);

    // Aller-retour sRGB <-> lineaire : la comparaison se fait au dix-millieme.
    stage.update(0, 0);
    expect(read().r).toBeCloseTo(0.7, 4);
    expect(read().g).toBeCloseTo(0.42, 4);

    stage.update(0, 1);
    expect(read().r).toBeCloseTo(1, 4);
    expect(read().g).toBeCloseTo(0.87, 4);
  });

  it('borne la ferveur a 1', () => {
    const { stage } = makeStage();
    stage.update(0, 1);
    const at1 = stage.rim.material.color.getHexString();
    stage.update(0, 9);
    expect(stage.rim.material.color.getHexString()).toBe(at1);
  });

  it('balaie la salle avec les projecteurs', () => {
    const { stage } = makeStage();
    const sweeps = child<Group>(stage.group, 'sweeps');
    stage.update(0, 0);
    const first = sweeps.children[0];
    if (!first) throw new Error('projecteur absent');
    expect(first.rotation.z).toBeCloseTo(0, 10);
    expect(first.rotation.x).toBeCloseTo(0.65, 10);

    stage.update(3, 0);
    expect(first.rotation.z).toBeCloseTo(Math.sin(1.5) * 0.55, 10);
    expect(first.rotation.x).toBeCloseTo(0.4 + Math.cos(1.11) * 0.25, 10);
  });
});

describe('createStage — liberation', () => {
  it('libere ses geometries et ses materiaux', () => {
    const { stage } = makeStage();
    const geometries = new Set<{ dispose: () => void }>();
    const materials = new Set<{ dispose: () => void }>();
    stage.group.traverse((o) => {
      const mesh = o as Partial<Mesh>;
      if (mesh.geometry) geometries.add(mesh.geometry);
      if (mesh.material) materials.add(mesh.material as Material);
    });
    expect(geometries.size).toBeGreaterThan(0);
    const spies = [...geometries, ...materials].map((r) => vi.spyOn(r, 'dispose'));

    stage.dispose();

    for (const spy of spies) expect(spy).toHaveBeenCalledOnce();
    expect(stage.group.children).toHaveLength(0);
  });

  it('ne touche pas aux ressources qu on lui a pretees', () => {
    const { stage, gradientMap, gridTexture } = makeStage();
    const spies = [vi.spyOn(gradientMap, 'dispose'), vi.spyOn(gridTexture, 'dispose')];
    stage.dispose();
    for (const spy of spies) expect(spy).not.toHaveBeenCalled();
  });
});
