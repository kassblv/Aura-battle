import type { Animation } from '@aura/content';
import { JOINT_NAMES, type JointName } from './pose.js';
import { samplePose } from './sample.js';

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

/** Le contenu est en centimetres, y negatif vers le haut. */
const CM = 0.01;

/**
 * Pivot du salto, en metres.
 *
 * Doit suivre `FLIP_PIVOT` de `arena/rig.ts` : c est autour de ce point que le
 * rig fait tourner le corps. Mesurer sans lui donnerait un salto arriere cadre
 * comme une pose debout.
 */
const FLIP_PIVOT = 0.85;

/**
 * Marge autour des articulations, en metres.
 *
 * Les positions du contenu sont des **axes** d os : le volume dessine deborde
 * de part et d autre, et la tete a un crane, des cheveux et un contour. Sans
 * cette marge, le cadrage coupe le sommet du crane. Elle couvre aussi
 * l ecartement en profondeur que le rig donne aux membres (`DEPTH`, 12 cm),
 * absent du contenu qui est dessine a plat.
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

/** Une articulation, la ou le rig la posera : metres, y vers le haut, 0 au sol. */
export type JointVisitor = (x: number, y: number, z: number, joint: JointName) => void;

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

    for (const name of JOINT_NAMES) {
      const joint = pose.joints[name];
      const dx = joint[0] * CM;
      // Le salto tourne le corps autour du pivot : mesurer la pose a plat
      // cadrerait un personnage debout la ou il est tete en bas.
      const dy = -joint[1] * CM - FLIP_PIVOT;
      visit(
        dx * cos - dy * sin,
        dx * sin + dy * cos + FLIP_PIVOT + root,
        // Le salto tourne dans le plan x-y : la profondeur n en depend pas.
        joint[2] * CM,
        name,
      );
    }
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

  return {
    radius: radius + LIMB_MARGIN,
    // Le sol reste le sol : un personnage debout ne doit pas etre cadre avec
    // une marge de dix-huit centimetres de plancher sous les pieds.
    minY: Math.max(0, minY - LIMB_MARGIN),
    maxY: maxY + LIMB_MARGIN,
    headY: headSum / steps,
    hipY: hipSum / steps,
  };
}
