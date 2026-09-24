import type { Animation } from '@aura/content';
import { CM, FLIP_PIVOT, SHOULDER_DROP, skeletonDepths } from './layout.js';
import { JOINT_NAMES, type JointName } from './pose.js';
import { samplePose } from './sample.js';
import { SECONDARY_REACH } from './secondary.js';

/**
 * Encombrement d une animation, en metres.
 *
 * A quoi ca sert : cadrer. Un salto arriere monte a plus de deux metres, une
 * levitation decolle, une T-pose est large ; cadres tous les trois a la meme
 * distance, on coupe les pieds de l un et on perd l autre au loin. Plutot que
 * de faire declarer une distance a chaque danse, on mesure ce qu elle occupe
 * reellement — une nouvelle danse qui saute plus haut est cadree correctement
 * sans qu on touche une ligne de code (regle d or n°5).
 *
 * Pure et deterministe : meme animation, memes bornes. Aucune horloge, aucun
 * Three.js — donc testable sans navigateur.
 */

/**
 * Marge autour des articulations, en metres.
 *
 * Les positions du contenu sont des **axes** d os : le volume dessine deborde
 * de part et d autre, et la tete a un crane, des cheveux et un contour. Sans
 * cette marge, le cadrage coupe le sommet du crane.
 *
 * Elle ne couvre **pas** l ecartement en profondeur des membres : celui-la est
 * applique article par article via `skeletonDepths`, exactement comme le rig
 * le dessine. Le confondre avec la marge de volume revenait a esperer qu un
 * seul nombre couvre a la fois un crane et douze centimetres d ecartement — la
 * T-pose, la toupie, le haussement d epaules et la levitation debordaient du
 * cadre de sept centimetres.
 */
export const LIMB_MARGIN = 0.18;

/**
 * Nombre d instants echantillonnes sur une boucle.
 *
 * L interpolation Catmull-Rom **deborde** des images cles : mesurer les seules
 * images cles sous-estimerait l amplitude reelle. Trente-deux pas suffisent —
 * l animation la plus rapide dure 0,62 s, soit un echantillon toutes les 20 ms.
 */
const SAMPLES = 32;

export interface AnimationBounds {
  /**
   * Rayon horizontal, en metres, mesure depuis l axe vertical du personnage.
   *
   * Un rayon, pas une largeur : le joueur peut faire tourner son personnage,
   * et la T-pose de ce portage tend ses bras en **profondeur**, pas dans le
   * plan du dessin. Une mesure qui ignorerait `z` la trouverait plus etroite
   * que des bras croises, et la cadrerait de travers des qu on tourne.
   */
  readonly radius: number;
  /** Altitudes, en metres, 0 au sol. */
  readonly minY: number;
  readonly maxY: number;
  /** Hauteur moyenne de la tete sur la boucle : le point de regard naturel. */
  readonly headY: number;
  /** Hauteur moyenne du bassin : la limite basse d un plan rapproche. */
  readonly hipY: number;
}

/**
 * Point du squelette en volume.
 *
 * Les onze articulations du dessin, plus les deux epaules que le rig ajoute :
 * le contenu n en a pas, mais elles sont ce qu il y a de plus large sur une
 * pose bras le long du corps.
 */
export type SkeletonPoint = JointName | 'shoulderLeft' | 'shoulderRight';

/** Un point du squelette, la ou le rig le posera : metres, y vers le haut, 0 au sol. */
export type JointVisitor = (x: number, y: number, z: number, joint: SkeletonPoint) => void;

/**
 * Parcourt la boucle et rend chaque articulation en coordonnees de scene.
 *
 * Expose pour que le cadrage puisse etre **verifie** sur les positions
 * reelles plutot que sur une boite englobante : la boite du salto arriere a
 * des coins ou le personnage ne va jamais, et exiger qu ils tiennent dans
 * l image reculerait la camera pour rien.
 */
export function forEachWorldJoint(
  animation: Animation,
  samples: number,
  visit: JointVisitor,
): void {
  const float = animation.flags?.float ?? 0;
  const steps = Math.max(1, samples);
  const depths = skeletonDepths(animation.flags);

  /**
   * Profondeur et recul de chaque articulation, tels que le rig les applique.
   *
   * `facing` vaut 1 : on mesure un encombrement, et un rayon ne change pas de
   * signe quand le personnage se retourne.
   */
  const placement: Readonly<Record<JointName, readonly [number, number]>> = {
    head: [0, 0],
    neck: [0, 0],
    hip: [0, 0],
    le: [depths.elbowShift, depths.elbowLeft],
    lh: [depths.handShift, depths.handLeft],
    re: [depths.elbowShift, depths.elbowRight],
    rh: [depths.handShift, depths.handRight],
    lk: [0, depths.kneeLeft],
    lf: [0, depths.footLeft],
    rk: [0, depths.kneeRight],
    rf: [0, depths.footRight],
  };

  for (let i = 0; i < steps; i++) {
    const time = (i / steps) * animation.loop.duration;
    const pose = samplePose(animation, time);

    /**
     * Elevation, reprise a l identique de `rig.ts`.
     *
     * Le rig leve la **racine**, pas le corps a l interieur du pivot ; et le
     * balancement de levitation fait partie de l amplitude qu il faut cadrer.
     */
    const bob = float === 0 ? 0 : Math.sin(time * 1.6) * 5 * Math.min(1, Math.abs(float) / 14);
    const root = Math.max(0, (-pose.lift - float - bob) * CM);

    const cos = Math.cos(pose.pitch);
    const sin = Math.sin(pose.pitch);

    /** Le salto tourne dans le plan x-y : la profondeur n en depend pas. */
    const send = (name: SkeletonPoint, x: number, y: number, z: number): void => {
      // Le salto tourne le corps autour du pivot : mesurer la pose a plat
      // cadrerait un personnage debout la ou il est tete en bas.
      const dy = y - FLIP_PIVOT;
      visit(x * cos - dy * sin, x * sin + dy * cos + FLIP_PIVOT + root, z, name);
    };

    for (const name of JOINT_NAMES) {
      const joint = pose.joints[name];
      const [shift, depth] = placement[name];
      send(name, joint[0] * CM + shift, -joint[1] * CM, depth + joint[2] * CM);
    }

    /**
     * Les epaules, que le dessin n a pas.
     *
     * Le rig les pose au niveau du cou, ecartees de `SHOULDER_SPAN` : sur une
     * pose bras le long du corps, ce sont elles le point le plus large.
     */
    const neck = pose.joints.neck;
    const shoulderY = -neck[1] * CM - SHOULDER_DROP;
    send('shoulderLeft', neck[0] * CM, shoulderY, depths.shoulderLeft + neck[2] * CM);
    send('shoulderRight', neck[0] * CM, shoulderY, depths.shoulderRight + neck[2] * CM);
  }
}

export function animationBounds(animation: Animation, samples = SAMPLES): AnimationBounds {
  let radius = 0;
  let minY = Number.POSITIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  let headSum = 0;
  let hipSum = 0;
  const steps = Math.max(1, samples);

  forEachWorldJoint(animation, steps, (x, y, z, name) => {
    const reach = Math.hypot(x, z);
    if (reach > radius) radius = reach;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
    if (name === 'head') headSum += y;
    if (name === 'hip') hipSum += y;
  });

  /**
   * La pose affichee n est pas la pose ecrite : le mouvement secondaire
   * (`secondary.ts`) respire, transfere le poids et fait trainer les mains. Il
   * ne s en ecarte jamais de plus de `SECONDARY_REACH` — c est ce qu on ajoute
   * ici, plutot que d esperer que la marge de volume l absorbe : elle n avait
   * que 2,4 cm de jeu sur la moitie du catalogue.
   */
  const margin = LIMB_MARGIN + SECONDARY_REACH * CM;
  return {
    radius: radius + margin,
    // Le sol reste le sol : un personnage debout ne doit pas etre cadre avec
    // une marge de dix-huit centimetres de plancher sous les pieds.
    // Vers le bas, rien a ajouter : le mouvement secondaire ne bouge pas les
    // pieds, et c est eux qui touchent le sol.
    minY: Math.max(0, minY - LIMB_MARGIN),
    maxY: maxY + margin,
    headY: headSum / steps,
    hipY: hipSum / steps,
  };
}
