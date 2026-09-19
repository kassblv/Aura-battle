import { SKIN_TONES } from '@aura/content';
import {
  CapsuleGeometry,
  Color,
  DynamicDrawUsage,
  Euler,
  Group,
  InstancedMesh,
  Matrix4,
  MeshBasicMaterial,
  MeshToonMaterial,
  Quaternion,
  SphereGeometry,
  type Texture,
  Vector3,
} from 'three';

/**
 * Le public des gradins.
 *
 * Un spectateur n est pas une gelule : il a une tete, un buste et deux bras qui
 * bougent separement. Chaque partie du corps vit dans son propre
 * `InstancedMesh` — cinq appels de dessin pour deux cent dix personnes, la ou
 * deux cent dix groupes en couteraient des milliers. Les bras ont leurs propres
 * instances parce qu une matrice d instance ne peut pas animer un sous-objet.
 *
 * Les places sont calees sur les gradins de `stage.ts` : meme arc, memes rayons,
 * memes hauteurs de marche. Un public qui flotte se lit comme des gens
 * suspendus, et la profondeur du fond disparait avec lui.
 */

export const CROWD_SIZE = 210;

/** Doit suivre `stage.ts` : c est la meme tribune. */
const TIER_COUNT = 4;
const TIER_HEIGHT = 0.42;
const FLOOR_Y = -0.45;
const STANDS_START = Math.PI * 1.5 + 0.9;
const STANDS_ARC = Math.PI * 2 - 1.8;
const TIER_INNER = 4.2;
const TIER_DEPTH = 0.9;

/** Hauteur des epaules au-dessus de la marche. */
const SHOULDER = 0.3;

interface Seat {
  readonly x: number;
  readonly z: number;
  readonly y: number;
  readonly phase: number;
  readonly speed: number;
  readonly lean: number;
  readonly glowstick: boolean;
}

export interface CrowdResources {
  readonly gradientMap: Texture;
}

export interface Crowd {
  readonly group: Group;
  /** `hype` entre 0 et 1 : la ferveur leve les bras et fait sauter la foule. */
  update(elapsedSeconds: number, hype: number): void;
  dispose(): void;
}

export function createCrowd(resources: CrowdResources, rng: () => number = Math.random): Crowd {
  const { gradientMap } = resources;
  const group = new Group();
  group.name = 'crowd';

  const geometries = {
    body: new CapsuleGeometry(0.16, 0.3, 3, 8),
    head: new SphereGeometry(0.125, 12, 9),
    arm: new CapsuleGeometry(0.045, 0.26, 2, 6),
    glowstick: new CapsuleGeometry(0.022, 0.2, 2, 5),
  };

  const cloth = new MeshToonMaterial({ color: 0xffffff, gradientMap });
  const skin = new MeshToonMaterial({ color: 0xffffff, gradientMap });
  // Les batons ne prennent pas la lumiere : ils en emettent.
  const neon = new MeshBasicMaterial({ color: 0xffffff });

  const parts = {
    body: new InstancedMesh(geometries.body, cloth, CROWD_SIZE),
    head: new InstancedMesh(geometries.head, skin, CROWD_SIZE),
    armLeft: new InstancedMesh(geometries.arm, cloth, CROWD_SIZE),
    armRight: new InstancedMesh(geometries.arm, cloth, CROWD_SIZE),
    glowstick: new InstancedMesh(geometries.glowstick, neon, CROWD_SIZE),
  };

  for (const [name, mesh] of Object.entries(parts)) {
    mesh.name = name;
    mesh.instanceMatrix.setUsage(DynamicDrawUsage);
    // La foule entoure la camera : la faire sortir du champ par morceaux
    // couterait un test d englobement par partie, pour rien.
    mesh.frustumCulled = false;
    group.add(mesh);
  }

  const seats: Seat[] = [];
  const tint = new Color();
  const hidden = new Matrix4().makeScale(0, 0, 0);

  for (let i = 0; i < CROWD_SIZE; i++) {
    const tier = i % TIER_COUNT;
    // Meme repere que les marches : l anneau est tourne de -90 degres autour
    // de x, donc l angle se lit en (cos, -sin) dans le plan du sol.
    const angle = STANDS_START + rng() * STANDS_ARC;
    const radius = TIER_INNER + tier * TIER_DEPTH + 0.2 + rng() * (TIER_DEPTH - 0.4);
    const hasGlowstick = rng() < 0.34;

    seats.push({
      x: Math.cos(angle) * radius,
      z: -Math.sin(angle) * radius,
      y: FLOOR_Y + (tier + 1) * TIER_HEIGHT + SHOULDER,
      phase: rng() * Math.PI * 2,
      speed: 1.9 + rng() * 1.6,
      lean: (rng() - 0.5) * 0.24,
      glowstick: hasGlowstick,
    });

    tint.setHSL(0.68 + rng() * 0.22, 0.45 + rng() * 0.3, 0.3 + rng() * 0.24);
    parts.body.setColorAt(i, tint);
    parts.armLeft.setColorAt(i, tint);
    parts.armRight.setColorAt(i, tint);
    const tone = SKIN_TONES[Math.floor(rng() * SKIN_TONES.length)] ?? '#f3cfae';
    parts.head.setColorAt(i, tint.set(tone));
    tint.setHSL(0.6 + rng() * 0.3, 0.9, 0.62);
    parts.glowstick.setColorAt(i, tint);
    if (!hasGlowstick) parts.glowstick.setMatrixAt(i, hidden);
  }

  for (const mesh of Object.values(parts)) {
    if (mesh.instanceColor !== null) mesh.instanceColor.needsUpdate = true;
  }

  const matrix = new Matrix4();
  const rotation = new Quaternion();
  const position = new Vector3();
  const scale = new Vector3(1, 1, 1);
  const euler = new Euler();

  /**
   * Derniere image calculee.
   *
   * Reenvoyer deux cent dix matrices au GPU alors que rien n a bouge est
   * exactement le genre de depense qu une image a 60 Hz ne peut pas se
   * permettre — et la foule ne bouge pas pendant une pause ou un ralenti.
   */
  let lastElapsed = Number.NaN;
  let lastHype = Number.NaN;
  let disposed = false;

  return {
    group,

    update(elapsed, hype) {
      if (elapsed === lastElapsed && hype === lastHype) return;
      lastElapsed = elapsed;
      lastHype = hype;

      for (let i = 0; i < CROWD_SIZE; i++) {
        const seat = seats[i];
        if (seat === undefined) continue;

        const beat = Math.sin(elapsed * seat.speed + seat.phase);
        const y = seat.y + Math.abs(beat) * (0.05 + hype * 0.17);

        euler.set(0, 0, seat.lean + beat * 0.06);
        rotation.setFromEuler(euler);

        position.set(seat.x, y, seat.z);
        matrix.compose(position, rotation, scale);
        parts.body.setMatrixAt(i, matrix);

        position.set(seat.x, y + 0.33, seat.z);
        matrix.compose(position, rotation, scale);
        parts.head.setMatrixAt(i, matrix);

        // Au repos les bras pendent ; la ferveur les envoie au-dessus de la tete.
        const raise = Math.min(1, hype * 1.25) * (0.55 + 0.45 * beat);
        const swing = 0.35 + raise * 2.1;
        const armY = y + 0.1 + raise * 0.22;

        euler.set(0, 0, swing);
        rotation.setFromEuler(euler);
        position.set(seat.x - 0.17 - raise * 0.03, armY, seat.z + 0.05);
        matrix.compose(position, rotation, scale);
        parts.armLeft.setMatrixAt(i, matrix);

        euler.set(0, 0, -swing);
        rotation.setFromEuler(euler);
        position.set(seat.x + 0.17 + raise * 0.03, armY, seat.z + 0.05);
        matrix.compose(position, rotation, scale);
        parts.armRight.setMatrixAt(i, matrix);

        if (seat.glowstick) {
          position.set(seat.x + 0.17 + raise * 0.24, y + 0.32 + raise * 0.42, seat.z + 0.05);
          matrix.compose(position, rotation, scale);
          parts.glowstick.setMatrixAt(i, matrix);
        }
      }

      for (const mesh of Object.values(parts)) mesh.instanceMatrix.needsUpdate = true;
    },

    dispose() {
      if (disposed) return;
      disposed = true;
      for (const geometry of Object.values(geometries)) geometry.dispose();
      cloth.dispose();
      skin.dispose();
      neon.dispose();
      for (const mesh of Object.values(parts)) mesh.dispose();
      group.clear();
    },
  };
}
