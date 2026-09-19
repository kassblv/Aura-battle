import { JOINT_NAMES, type Animation, type AnimationFrame, type JointName } from '@aura/content';
import type { Joint3D, Pose } from './pose.js';

/**
 * Echantillonnage d'une animation (port du prototype, section « Squelette fluide »).
 *
 * Pure et deterministe : meme animation et meme instant donnent toujours la
 * meme pose. Aucun etat, aucune horloge — le temps entre en parametre. C'est
 * ce qui permet de la tester sans navigateur, et de la rejouer image par image
 * dans le visualiseur d'animations.
 *
 * Le lissage par ressorts, lui, est ailleurs : il a une memoire, donc il ne
 * peut pas vivre dans une fonction pure (voir `spring.ts`).
 */

const TAU = Math.PI * 2;

/** Ramene un angle dans [-pi, pi] : le plus court chemin autour du cercle. */
const wrapAngle = (angle: number): number => angle - TAU * Math.round(angle / TAU);

/** Adoucissement en S du prototype : derivee nulle aux deux extremites. */
const smooth = (t: number): number => t * t * (3 - 2 * t);

/**
 * Catmull-Rom sur quatre points.
 *
 * Passe exactement par `p1` et `p2` et **deborde** dans les virages : c'est ce
 * debordement qui donne l'elan du prototype. Une interpolation lineaire
 * donnerait un mouvement juste mais mort.
 */
function catmullRom(p0: number, p1: number, p2: number, p3: number, k: number): number {
  const k2 = k * k;
  const k3 = k2 * k;
  return (
    0.5 *
    (2 * p1 +
      (p2 - p0) * k +
      (2 * p0 - 5 * p1 + 4 * p2 - p3) * k2 +
      (3 * p1 - p0 - 3 * p2 + p3) * k3)
  );
}

/** Parts de boucle de chaque image, normalisees pour sommer a un. */
function weightsOf(animation: Animation): readonly number[] {
  const count = animation.frames.length;
  const declared = animation.loop.weights;
  // Absentes, nulles, ou de longueur incoherente : la repartition egale.
  if (declared?.length !== count) {
    return Array.from({ length: count }, () => 1 / count);
  }
  const total = declared.reduce((sum, weight) => sum + weight, 0);
  // Des parts qui somment a zero ne disent rien : on retombe sur l'egalite
  // plutot que de produire des NaN a chaque image.
  if (!(total > 0)) return Array.from({ length: count }, () => 1 / count);
  return declared.map((weight) => weight / total);
}

/**
 * Image courante et avancement dans cette image.
 *
 * Le modulo est pris **avant** la boucle de soustraction : un temps negatif ou
 * tres grand doit retomber dans la boucle, pas saturer sur la derniere image.
 */
function locate(
  weights: readonly number[],
  progress: number,
): { readonly index: number; readonly within: number } {
  const count = weights.length;
  let remaining = ((progress % 1) + 1) % 1;
  let index = 0;
  while (index < count - 1 && remaining > (weights[index] ?? 0)) {
    remaining -= weights[index] ?? 0;
    index += 1;
  }
  const span = weights[index] ?? 1;
  return { index, within: span > 0 ? Math.min(1, Math.max(0, remaining / span)) : 0 };
}

const depth = (frame: AnimationFrame, joint: JointName): number => frame.z?.[joint] ?? 0;

/**
 * Pose de l'animation a l'instant demande, en secondes.
 *
 * `offsetSeconds` decale la phase : deux personnages jouant la meme animation
 * avec un decalage different ne respirent pas a l'unisson, ce qui suffit a
 * casser l'effet « clones » du prototype.
 */
export function samplePose(animation: Animation, timeSeconds: number, offsetSeconds = 0): Pose {
  const frames = animation.frames;
  const count = frames.length;
  const weights = weightsOf(animation);
  const { index, within } = locate(
    weights,
    (timeSeconds + offsetSeconds) / animation.loop.duration,
  );
  const k = animation.loop.ease === true ? smooth(within) : within;

  const at = (offset: number): AnimationFrame =>
    // L'index est ramene dans [0, count[ juste au-dessus : la case existe.
    frames[(((index + offset) % count) + count) % count]!;
  const [f0, f1, f2, f3] = [at(-1), at(0), at(1), at(2)];

  const joints = {} as Record<JointName, Joint3D>;
  for (const joint of JOINT_NAMES) {
    joints[joint] = [
      catmullRom(
        f0.joints[joint][0],
        f1.joints[joint][0],
        f2.joints[joint][0],
        f3.joints[joint][0],
        k,
      ),
      catmullRom(
        f0.joints[joint][1],
        f1.joints[joint][1],
        f2.joints[joint][1],
        f3.joints[joint][1],
        k,
      ),
      catmullRom(depth(f0, joint), depth(f1, joint), depth(f2, joint), depth(f3, joint), k),
    ];
  }

  /**
   * Les angles s'interpolent par le plus court chemin, pas par leur valeur
   * brute. Sans cela, une boucle qui passe de +170° a -170° fait faire au
   * personnage un tour complet a chaque cycle.
   *
   * On reconstruit donc une suite continue autour de `a1` avant d'interpoler :
   * chaque angle est exprime comme le precedent plus le plus court ecart.
   */
  const angle = (key: 'rot' | 'hy' | 'pitch'): number => {
    const a1 = f1[key] ?? 0;
    const a2 = a1 + wrapAngle((f2[key] ?? 0) - a1);
    const a0 = a1 - wrapAngle(a1 - (f0[key] ?? 0));
    const a3 = a2 + wrapAngle((f3[key] ?? 0) - (f2[key] ?? 0));
    return catmullRom(a0, a1, a2, a3, k);
  };

  return {
    joints,
    // Catmull-Rom deborde : sans cette borne, le debordement d'un saut
    // enfoncerait le personnage sous le sol a l'atterrissage.
    lift: Math.min(0, catmullRom(f0.lift ?? 0, f1.lift ?? 0, f2.lift ?? 0, f3.lift ?? 0, k)),
    rot: angle('rot'),
    hy: angle('hy'),
    pitch: angle('pitch'),
  };
}
