import {
  CylinderGeometry,
  Group,
  Matrix4,
  Mesh,
  type Material,
  Quaternion,
  SphereGeometry,
  Vector3,
} from 'three';

/**
 * Mains articulees (port du prototype, `buildHand` / `updateHand`).
 *
 * Quatre doigts a deux phalanges chacun, plus un pouce opposable qui tourne sur
 * un axe different des doigts. Un bloc unique qui se ferme donne une moufle :
 * ce qui fait lire une main, c est que les phalanges se plient l une apres
 * l autre — un poing, un doigt pointe et un V de victoire sont alors trois
 * formes distinctes, pas trois tailles de bloc.
 */

/** Orientation de la paume, telle que le contenu la declare. */
export type HandFacing = 'in' | 'up' | 'down' | 'fwd' | 'back';

/** `[forme, orientation]`, le couple que porte `hands` dans une animation. */
export type HandSpec = readonly [string, string];

interface Shape {
  /** Courbure visee de chaque doigt, de l index a l auriculaire. */
  readonly curl: readonly [number, number, number, number];
  /** Flexion du pouce, puis son ecartement. */
  readonly thumb: number;
  readonly thumbSpread: number;
  /** Ecartement des doigts entre eux. */
  readonly spread: number;
}

export const HAND_SHAPES: Readonly<Record<string, Shape>> = Object.freeze({
  relax: { curl: [0.35, 0.45, 0.55, 0.6], thumb: 0.35, thumbSpread: 0.5, spread: 0.1 },
  fist: { curl: [1, 1, 1, 1], thumb: 0.9, thumbSpread: 0.35, spread: 0 },
  open: { curl: [0.02, 0.02, 0.04, 0.06], thumb: 0.05, thumbSpread: 0.9, spread: 0.9 },
  point: { curl: [0, 1, 1, 1], thumb: 0.85, thumbSpread: 0.4, spread: 0 },
  L: { curl: [0, 1, 1, 1], thumb: 0, thumbSpread: 1.5, spread: 0 },
  peace: { curl: [0, 0, 1, 1], thumb: 0.85, thumbSpread: 0.4, spread: 0.6 },
});

/** Amortissement exponentiel, independant du pas de temps. */
const damp = (rate: number, dt: number): number => 1 - Math.exp(-rate * dt);

const FINGER_X = [-0.022, -0.0075, 0.0075, 0.022] as const;
const FINGER_LENGTH = [0.023, 0.026, 0.025, 0.02] as const;

export interface Hand {
  readonly group: Group;
  /** Courbure courante de chaque doigt : lue par les tests. */
  readonly curl: number[];
  /** Applique une forme, en douceur. */
  shape(spec: HandSpec, deltaSeconds: number): void;
  /** Oriente la main : l axe des doigts prolonge l avant-bras. */
  /**
   * Oriente la main : l axe des doigts prolonge l avant-bras.
   *
   * `facing` arrive du contenu, donc en `string` : une orientation inconnue
   * retombe sur `in` plutot que de faire echouer le rendu d une animation.
   */
  aim(at: Vector3, fromElbow: Vector3, facing: string, deltaSeconds: number): void;
  setMaterial(material: Material): void;
  dispose(): void;
}

export function createHand(
  makeOutlined: (parent: Group, geometry: 'sphere' | 'finger') => Group,
): Hand {
  const group = new Group();
  const meshes: Mesh[] = [];
  const owned: (CylinderGeometry | SphereGeometry)[] = [];

  const palm = makeOutlined(group, 'sphere');
  palm.scale.set(0.036, 0.04, 0.02);
  palm.position.set(0, 0.022, 0);

  const segment = (parent: Group, length: number, radius: number): void => {
    const geometry = new CylinderGeometry(1, 1, 1, 7);
    const mesh = new Mesh(geometry);
    mesh.scale.set(radius, length, radius);
    mesh.position.y = length / 2;
    parent.add(mesh);
    meshes.push(mesh);
    owned.push(geometry);
  };

  const knuckle = (parent: Group, y: number, radius: number): void => {
    const geometry = new SphereGeometry(1, 8, 6);
    const mesh = new Mesh(geometry);
    mesh.scale.setScalar(radius);
    mesh.position.y = y;
    parent.add(mesh);
    meshes.push(mesh);
    owned.push(geometry);
  };

  const fingers = FINGER_X.map((x, i) => {
    const length = FINGER_LENGTH[i] ?? 0.024;
    const base = new Group();
    base.position.set(x, 0.05, 0);
    group.add(base);
    segment(base, length, 0.0082);
    const tip = new Group();
    tip.position.y = length;
    base.add(tip);
    knuckle(tip, 0, 0.0082);
    segment(tip, length * 0.8, 0.0076);
    knuckle(tip, length * 0.8, 0.0076);
    return { base, tip };
  });

  const thumbBase = new Group();
  group.add(thumbBase);
  segment(thumbBase, 0.02, 0.0095);
  const thumbTip = new Group();
  thumbTip.position.y = 0.02;
  thumbBase.add(thumbTip);
  knuckle(thumbTip, 0, 0.0095);
  segment(thumbTip, 0.017, 0.0088);
  knuckle(thumbTip, 0.017, 0.0088);

  const curl = [0.35, 0.45, 0.55, 0.6];
  let thumb = 0.35;
  let thumbSpread = 0.5;
  let spread = 0.1;
  let aimed = false;

  const axis = new Vector3();
  const normal = new Vector3();
  const side = new Vector3();
  const front = new Vector3();
  const basis = new Matrix4();
  const rotation = new Quaternion();

  return {
    group,
    curl,

    shape(spec, dt) {
      const target = HAND_SHAPES[spec[0]] ?? HAND_SHAPES.relax;
      if (target === undefined) return;
      const a = damp(14, dt);
      for (let i = 0; i < 4; i++) {
        curl[i] = (curl[i] ?? 0) + ((target.curl[i] ?? 0) - (curl[i] ?? 0)) * a;
        const finger = fingers[i];
        if (finger === undefined) continue;
        finger.base.rotation.set(-(curl[i] ?? 0) * 1.45, 0, (i - 1.5) * spread * 0.16);
        finger.tip.rotation.set(-(curl[i] ?? 0) * 1.7, 0, 0);
      }
      thumb += (target.thumb - thumb) * a;
      thumbSpread += (target.thumbSpread - thumbSpread) * a;
      spread += (target.spread - spread) * a;
    },

    aim(at, fromElbow, facing, dt) {
      axis.subVectors(at, fromElbow);
      if (axis.lengthSq() < 1e-8) axis.set(0, 1, 0);
      axis.normalize();

      /**
       * L orientation de la paume vient du contenu. Sans elle, une main ouverte
       * paume vers le sol et la meme paume vers le ciel seraient le meme dessin.
       */
      switch (facing) {
        case 'up':
          normal.set(0, 1, 0);
          break;
        case 'down':
          normal.set(0, -1, 0);
          break;
        case 'fwd':
          normal.set(1, 0, 0);
          break;
        case 'back':
          normal.set(-1, 0, 0);
          break;
        default:
          normal.set(0, 0, at.z >= 0 ? -1 : 1);
      }

      front.copy(normal).negate();
      front.addScaledVector(axis, -front.dot(axis));
      if (front.lengthSq() < 1e-4) {
        front.set(0, 0, 1);
        front.addScaledVector(axis, -front.dot(axis));
      }
      front.normalize();
      side.crossVectors(axis, front);
      basis.makeBasis(side, axis, front);
      rotation.setFromRotationMatrix(basis);

      if (aimed) group.quaternion.slerp(rotation, damp(16, dt));
      else {
        group.quaternion.copy(rotation);
        aimed = true;
      }

      group.position.copy(at);
      group.scale.setScalar(1.35);

      const mirror = at.z < 0 ? -1 : 1;
      thumbBase.position.set(mirror * 0.028, 0.018, -0.006);
      thumbBase.rotation.set(-thumb * 0.8, 0, -mirror * (0.3 + thumbSpread * 0.75));
      thumbTip.rotation.set(-thumb * 1.1, 0, 0);
    },

    setMaterial(material) {
      for (const mesh of meshes) mesh.material = material;
      const inner = palm.children[0];
      if (inner instanceof Mesh) inner.material = material;
    },

    dispose() {
      for (const geometry of owned) geometry.dispose();
    },
  };
}
