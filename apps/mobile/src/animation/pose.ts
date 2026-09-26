import { JOINT_NAMES, type JointName } from '@aura/content';

/**
 * Pose du squelette a un instant donne.
 *
 * Elle est **plate et complete** : toutes les articulations sont presentes, et
 * la profondeur absente du contenu vaut zero. Le rendu n'a donc jamais a
 * decider quoi faire d'un champ manquant, soixante fois par seconde.
 */

/** Position d'une articulation : x, y dans le plan, z en profondeur. */
export type Joint3D = readonly [number, number, number];

export interface Pose {
  readonly joints: Readonly<Record<JointName, Joint3D>>;
  /** Elevation du personnage, negative vers le haut, jamais positive. */
  readonly lift: number;
  /** Inclinaison dans le plan, en radians. */
  readonly rot: number;
  /** Rotation autour de l'axe vertical, en radians. */
  readonly hy: number;
  /** Rotation de salto, en radians. */
  readonly pitch: number;
}

export { JOINT_NAMES, type JointName };
