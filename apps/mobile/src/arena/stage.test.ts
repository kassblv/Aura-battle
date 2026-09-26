import {
  type BufferGeometry as Geometry,
  type CircleGeometry,
  type CylinderGeometry,
  type MeshBasicMaterial,
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
import { arenaMood } from './mood.js';

function makeStage(rng: () => number = () => 0.5) {
  const gradientMap = new Texture();
  const floorTexture = new Texture();
  const hazeTexture = new Texture();
  return {
    stage: createStage({ gradientMap, floorTexture, hazeTexture }, rng),
    gradientMap,
    floorTexture,
    hazeTexture,
  };
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
      'haze',
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

  it('applique le cercle fourni sur le dessus de la plateforme', () => {
    const { stage, floorTexture } = makeStage();
    const top = child<Mesh<CircleGeometry, Material & { map: Texture | null }>>(
      stage.group,
      'platform-top',
    );
    expect(top.material.map).toBe(floorTexture);
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

  it('accroche les projecteurs au-dessus, derriere, et repartis autour du centre', () => {
    const sweeps = child<Group>(makeStage().stage.group, 'sweeps');
    expect(sweeps.children).toHaveLength(3);
    const xs = sweeps.children.map((piv) => piv.position.x);
    // Symetriques : la somme des abscisses tombe a zero quel qu en soit le
    // nombre. Le portage initial les posait a `-4,5 + i * 3`, ce qui les
    // centrait pour quatre et les decalait pour tout autre compte.
    expect(xs.reduce((a, b) => a + b, 0)).toBeCloseTo(0, 10);
    for (const piv of sweeps.children) {
      expect(piv.position.y).toBeGreaterThan(5);
      expect(piv.position.z).toBeLessThan(-3);
    }
  });

  /**
   * La brume separe le cercle du fond. Percee en son centre : elle ne voile
   * jamais ce qu on regarde, et c est tout l interet d un anneau.
   */
  it('pose la brume a plat, au ras du sol, et lui prete la texture fournie', () => {
    const { stage, hazeTexture } = makeStage();
    const haze = child<Mesh<CircleGeometry, Material & { map: Texture | null }>>(
      stage.group,
      'haze',
    );
    expect(haze.material.map).toBe(hazeTexture);
    expect(haze.rotation.x).toBeCloseTo(-Math.PI / 2, 10);
    // Au-dessus du bitume, sous le genou des combattants.
    expect(haze.position.y).toBeGreaterThan(-0.45);
    expect(haze.position.y).toBeLessThan(0.3);
    expect(haze.geometry.parameters.radius).toBeGreaterThan(2.8);
  });

  /**
   * Les bandeaux des gradins s eteignent avec la distance : a pleine
   * intensite sur les quatre rangs, le fond reprend le dessus sur les deux
   * seules choses a lire.
   */
  it('eteint les bandeaux rang apres rang', () => {
    const stands = child<Group>(makeStage().stage.group, 'stands');
    const levels = stands.children.map((tier) => {
      const strip = child<Mesh<CylinderGeometry, MeshBasicMaterial>>(tier as Group, 'strip');
      // Les bandeaux alternent deux teintes : on compare chaque rang a celui
      // de meme couleur, deux crans plus pres.
      return strip.material.color.getHSL({ h: 0, s: 0, l: 0 }).l;
    });
    expect(levels[2]).toBeLessThan(levels[0] ?? 0);
    expect(levels[3]).toBeLessThan(levels[1] ?? 0);
  });

  /**
   * Un materiau transparent **et** a double face est dessine deux fois par
   * Three.js. Les bandeaux s eteignent donc en couleur, pas en opacite : sur
   * un fond presque noir l image est la meme, le budget ne l est pas.
   */
  it('garde les bandeaux opaques, pour ne pas les payer deux fois', () => {
    const stands = child<Group>(makeStage().stage.group, 'stands');
    for (const tier of stands.children) {
      const strip = child<Mesh<CylinderGeometry, Material>>(tier as Group, 'strip');
      expect(strip.material.transparent).toBe(false);
    }
  });

  /** Meme raison, autre remede : un melange additif se moque de l ordre. */
  it('ne dessine les faisceaux qu une fois, le melange additif etant commutatif', () => {
    const sweeps = child<Group>(makeStage().stage.group, 'sweeps');
    for (const pivot of sweeps.children) {
      const beam = child<Mesh<Geometry, Material>>(pivot as Group, 'beam');
      expect(beam.material.transparent).toBe(true);
      expect(beam.material.forceSinglePass).toBe(true);
    }
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
    expect(pos.getX(STAR_COUNT - 1)).toBeCloseTo(pos.getX(0), 10);
  });
});

describe('createStage — animation', () => {
  it('rechauffe le liseré quand la ferveur monte', () => {
    const { stage } = makeStage();
    const read = () => stage.rim.material.color.getRGB({ r: 0, g: 0, b: 0 }, SRGBColorSpace);

    // Aller-retour sRGB <-> lineaire : la comparaison se fait au dix-millieme.
    stage.update(0, 0);
    const calm = read();
    expect(calm.r).toBeCloseTo(arenaMood(0).rimColor[0], 4);

    stage.update(0, 1);
    const blaze = read();
    expect(blaze.r).toBeCloseTo(arenaMood(1).rimColor[0], 4);
    // Plus chaud : le rouge gagne sur le bleu.
    expect(blaze.r - blaze.b).toBeGreaterThan(calm.r - calm.b);
  });

  it('leve la brume avec la salle', () => {
    const { stage } = makeStage();
    const haze = stage.group.getObjectByName('haze') as Mesh<CircleGeometry, Material>;
    stage.update(0, 0);
    const calm = haze.material.opacity;
    stage.update(0, 1);
    expect(haze.material.opacity).toBeGreaterThan(calm);
  });

  it('fait tourner la brume, seul mouvement du decor quand personne ne bouge', () => {
    const { stage } = makeStage();
    const haze = stage.group.getObjectByName('haze');
    if (!haze) throw new Error('brume absente');
    stage.update(0, 0);
    const start = haze.rotation.z;
    stage.update(6, 0);
    expect(haze.rotation.z).not.toBeCloseTo(start, 4);
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
    const { stage, gradientMap, floorTexture, hazeTexture } = makeStage();
    const spies = [
      vi.spyOn(gradientMap, 'dispose'),
      vi.spyOn(floorTexture, 'dispose'),
      vi.spyOn(hazeTexture, 'dispose'),
    ];
    stage.dispose();
    for (const spy of spies) expect(spy).not.toHaveBeenCalled();
  });
});
