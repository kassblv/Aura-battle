import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  CircleGeometry,
  ConeGeometry,
  CylinderGeometry,
  DoubleSide,
  Group,
  type Material,
  Mesh,
  MeshBasicMaterial,
  MeshToonMaterial,
  Points,
  PointsMaterial,
  RingGeometry,
  SRGBColorSpace,
  type Texture,
  TorusGeometry,
} from 'three';
import { ARENA_COLORS } from './palette.js';
import { clamp } from './math.js';

/**
 * Decor fixe de l arene : sol, plateforme, gradins, projecteurs, ciel etoile.
 *
 * Porte de la section « Rendu 3D » du prototype. Deux ecarts assumes :
 * - tout est accroche sous un seul groupe, pour pouvoir demonter la scene ;
 * - les materiaux ne sont plus partages entre arenes, sinon liberer l une
 *   crevait l autre.
 */

export const STAR_COUNT = 500;

/** Les gradins n entourent que l arriere et les cotes : le public de face gene. */
const STANDS_START = Math.PI * 1.5 + 0.9;
const STANDS_ARC = Math.PI * 2 - 1.8;
const TIER_COUNT = 4;
const TIER_HEIGHT = 0.42;
const FLOOR_Y = -0.45;

export interface StageResources {
  /** Degrade toon partage, detenu par la scene. */
  readonly gradientMap: Texture;
  /** Grille lumineuse peinte sur le dessus de la plateforme. */
  readonly gridTexture: Texture;
}

export interface Stage {
  readonly group: Group;
  /** Expose pour les tests et pour l accord avec la couleur d aura. */
  readonly rim: Mesh<TorusGeometry, MeshBasicMaterial>;
  /** `hype` entre 0 et 1 : ferveur du public, pilotee par les evenements. */
  update(elapsed: number, hype: number): void;
  dispose(): void;
}

export function createStage(resources: StageResources, rng: () => number = Math.random): Stage {
  const { gradientMap, gridTexture } = resources;
  const group = new Group();
  group.name = 'stage';

  const ground = new Mesh(
    new CircleGeometry(26, 48),
    new MeshToonMaterial({ color: ARENA_COLORS.ground, gradientMap }),
  );
  ground.name = 'ground';
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = FLOOR_Y;

  const platform = new Mesh(
    new CylinderGeometry(2.6, 2.8, 0.45, 64),
    new MeshToonMaterial({ color: ARENA_COLORS.platform, gradientMap }),
  );
  platform.name = 'platform';
  platform.position.y = -0.225;

  // Decale de 2 mm au-dessus de la plateforme : sans ce jeu, les deux surfaces
  // se disputent le meme plan et scintillent.
  const platformTop = new Mesh(
    new CircleGeometry(2.6, 64),
    new MeshBasicMaterial({ map: gridTexture, transparent: true, depthWrite: false }),
  );
  platformTop.name = 'platform-top';
  platformTop.rotation.x = -Math.PI / 2;
  platformTop.position.y = 0.002;

  const rim = new Mesh(
    new TorusGeometry(2.62, 0.03, 8, 140),
    new MeshBasicMaterial({ color: ARENA_COLORS.rim }),
  );
  rim.name = 'rim';
  rim.rotation.x = Math.PI / 2;
  rim.position.y = 0.004;

  const stands = buildStands(gradientMap);
  const sweeps = buildSweeps();
  const stars = buildStars(rng);

  group.add(ground, platform, platformTop, rim, stands, sweeps, stars);

  return {
    group,
    rim,

    update(elapsed: number, hype: number): void {
      const h = clamp(hype, 0, 1);
      // Le liseré vire au blanc chaud quand la salle s embrase.
      rim.material.color.setRGB(0.7 + 0.3 * h, 0.42 + 0.45 * h, 1, SRGBColorSpace);
      sweeps.children.forEach((pivot, i) => {
        const phase = i * 1.7;
        pivot.rotation.z = Math.sin(elapsed * 0.5 + phase) * 0.55;
        pivot.rotation.x = 0.4 + Math.cos(elapsed * 0.37 + phase) * 0.25;
      });
    },

    dispose(): void {
      disposeSubtree(group);
    },
  };
}

function buildStands(gradientMap: Texture): Group {
  const stands = new Group();
  stands.name = 'stands';
  const [dimStone, brightStone] = ARENA_COLORS.stands;
  const [coldStrip, warmStrip] = ARENA_COLORS.strips;

  for (let i = 0; i < TIER_COUNT; i++) {
    const radius = 4.2 + i * 0.9;
    const y = FLOOR_Y + (i + 1) * TIER_HEIGHT;
    const tier = new Group();
    tier.name = `tier-${i}`;

    // Les marches alternent deux violets : sans cela, les gradins se lisent
    // comme une seule masse plate.
    const stone = new MeshToonMaterial({
      color: i % 2 === 0 ? dimStone : brightStone,
      gradientMap,
      side: DoubleSide,
    });

    const step = new Mesh(
      new RingGeometry(radius, radius + 0.9, 72, 1, STANDS_START, STANDS_ARC),
      stone,
    );
    step.name = 'step';
    step.rotation.x = -Math.PI / 2;
    step.position.y = y;

    const wall = new Mesh(
      new CylinderGeometry(radius, radius, 0.42, 72, 1, true, 0.9, STANDS_ARC),
      stone,
    );
    wall.name = 'wall';
    wall.position.y = y - 0.21;

    const strip = new Mesh(
      new CylinderGeometry(radius + 0.005, radius + 0.005, 0.025, 72, 1, true, 0.9, STANDS_ARC),
      new MeshBasicMaterial({ color: i % 2 === 0 ? coldStrip : warmStrip, side: DoubleSide }),
    );
    strip.name = 'strip';
    strip.position.y = y - 0.02;

    tier.add(step, wall, strip);
    stands.add(tier);
  }

  return stands;
}

function buildSweeps(): Group {
  const sweeps = new Group();
  sweeps.name = 'sweeps';

  // Un seul cone pour les quatre faisceaux : meme forme, seule la teinte change.
  const beam = new ConeGeometry(1.2, 9, 24, 1, true);

  ARENA_COLORS.sweeps.forEach((color, i) => {
    const pivot = new Group();
    pivot.name = `sweep-${i}`;
    pivot.position.set(-4.5 + i * 3, 6.2, -3.8);

    const cone = new Mesh(
      beam,
      new MeshBasicMaterial({
        color,
        transparent: true,
        opacity: 0.07,
        blending: AdditiveBlending,
        depthWrite: false,
        side: DoubleSide,
        // Un faisceau mange par le brouillard ne ressemble plus a rien.
        fog: false,
      }),
    );
    cone.name = 'beam';
    // Le cone pend depuis son pivot : c est le pivot qu on fait tourner.
    cone.position.y = -4.5;

    pivot.add(cone);
    sweeps.add(pivot);
  });

  return sweeps;
}

function buildStars(rng: () => number): Points {
  const positions = new Float32Array(STAR_COUNT * 3);
  const radius = 45;

  for (let i = 0; i < STAR_COUNT; i++) {
    const theta = rng() * Math.PI * 2;
    // Seulement au-dessus de l horizon : personne ne regarde sous le sol.
    const phi = 0.1 + rng() * 1.2;
    positions[i * 3] = radius * Math.cos(theta) * Math.cos(phi);
    positions[i * 3 + 1] = radius * Math.sin(phi) - 3;
    positions[i * 3 + 2] = radius * Math.sin(theta) * Math.cos(phi);
  }

  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(positions, 3));

  const stars = new Points(
    geometry,
    new PointsMaterial({
      color: 0xe9e1ff,
      size: 0.22,
      transparent: true,
      opacity: 0.75,
      fog: false,
      depthWrite: false,
    }),
  );
  stars.name = 'stars';
  return stars;
}

/**
 * Libere geometries et materiaux d un sous-arbre, chacun une seule fois.
 *
 * Les ressources sont partagees (un materiau par gradin, un cone pour quatre
 * projecteurs) : sans dedoublonnage on appellerait `dispose` plusieurs fois sur
 * la meme ressource. Les textures pretees par la scene ne sont pas touchees,
 * c est a leur proprietaire de les liberer.
 */
export function disposeSubtree(root: Group): void {
  const geometries = new Set<BufferGeometry>();
  const materials = new Set<Material>();

  root.traverse((object) => {
    const node = object as Partial<Mesh>;
    if (node.geometry) {
      geometries.add(node.geometry);
    }
    if (node.material) {
      for (const material of Array.isArray(node.material) ? node.material : [node.material]) {
        materials.add(material);
      }
    }
  });

  for (const geometry of geometries) {
    geometry.dispose();
  }
  for (const material of materials) {
    material.dispose();
  }
  root.clear();
}
