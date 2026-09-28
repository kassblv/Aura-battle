import { JOINT_NAMES, type Animation, type JointName } from '@aura/content';
import type { Joint3D, Pose } from './pose.js';
import { samplePose } from './sample.js';
import { breatheInto } from './smooth.js';

/**
 * Mouvement secondaire : ce que le corps fait en plus du geste.
 *
 * Le contenu dit **le geste** — deux a six images cles par danse. Entre elles,
 * rien ne bouge qui ne soit ecrit : le buste ne respire pas, le poids ne passe
 * pas d une jambe a l autre, la tete et les mains arrivent en meme temps que le
 * coude qui les porte. C est exactement ce qui se lit comme un robot.
 *
 * Cette couche l ajoute a TOUTES les danses sans toucher leur JSON (regle d or
 * n°5) :
 *
 * - respiration (`breatheInto`) ;
 * - transfert de poids lateral, lent, pieds plantes ;
 * - rebond des genoux sur les danses `hype`, cale sur la boucle et plus
 *   franc quand la ferveur monte ;
 * - suivi en retard de la tete et des mains (overlapping action) : elles
 *   trainent derriere le buste et le coude qui les emportent.
 *
 * Pure et deterministe : le temps, le decalage de siege et la ferveur entrent
 * en parametre, rien n est tire au hasard. Le retard se calcule en
 * echantillonnant la meme animation un peu plus tot, pas avec une memoire.
 *
 * Ce qu elle ne doit jamais faire : casser une pose. Les pieds ne bougent pas,
 * le haut du corps bouge d un bloc (des bras croises restent croises, une main
 * en poche reste en poche), et aucune articulation ne s ecarte de plus de
 * `SECONDARY_REACH` de la pose ecrite — c est cette borne que le cadrage
 * ajoute a sa mesure.
 */

/** Ecart maximal d une articulation par rapport a la pose ecrite, en cm. */
export const SECONDARY_REACH = 3.5;

export interface SecondaryMotionOptions {
  /** Ferveur de la salle, de 0 a 1 : elle creuse le rebond des genoux. */
  readonly hype: number;
  /** `prefers-reduced-motion` : il ne reste que la respiration. */
  readonly reducedMotion: boolean;
}

/** Periode du transfert de poids, en secondes : lent, sous le rythme. */
const SWAY_PERIOD = 2.6;
/** Amplitude laterale du bassin, en cm. */
const SWAY = 1.4;

/** Duree visee d un rebond, en secondes : autour de 120 battements/min. */
const BEAT = 0.5;
/** Profondeur du rebond sans ferveur, puis ce que la ferveur y ajoute, en cm. */
const BOUNCE_BASE = 1.2;
const BOUNCE_HYPE = 1.6;
/** Avancee des genoux par centimetre de descente : une flexion, pas un tassement. */
const KNEE_FORWARD = 1.2;

/** Retard de la tete et des mains, en secondes. */
const LAG = 0.07;
/** Part du deplacement du buste que la tete ne suit pas encore. */
const HEAD_DRAG = 0.45;
/** Part du deplacement du coude que la main ne suit pas encore. */
const HAND_DRAG = 0.3;
/** Plafond du trainage, en cm : au-dela, un geste rapide se deformerait. */
const DRAG_LIMIT = 2.5;
/** Part de la rotation du corps que la tete rattrape en retard. */
const LOOK_DRAG = 0.6;
/** Plafond du retard de regard, en radians. */
const LOOK_LIMIT = 0.35;

const UPPER: readonly JointName[] = ['neck', 'head', 'le', 'lh', 're', 'rh'];

const clamp01 = (v: number): number => Math.min(1, Math.max(0, v));

type Mutable = Record<JointName, [number, number, number]>;

/** Ajoute `delta`, raccourci a `limit` s il le depasse. */
function addClamped(target: [number, number, number], delta: Joint3D, limit: number): void {
  const length = Math.hypot(delta[0], delta[1], delta[2]);
  const k = length > limit ? limit / length : 1;
  target[0] += delta[0] * k;
  target[1] += delta[1] * k;
  target[2] += delta[2] * k;
}

const minus = (a: Joint3D, b: Joint3D, scale: number): Joint3D => [
  (a[0] - b[0]) * scale,
  (a[1] - b[1]) * scale,
  (a[2] - b[2]) * scale,
];

/**
 * A quel point le personnage est debout, appuye sur ses jambes : de 0 a 1.
 *
 * Un salto, une levitation, une meditation assise ou un corps a terre n ont
 * pas de poids a transferer ni de genoux a flechir. Continu plutot que
 * booleen : l elevation d un saut monte progressivement, le rebond aussi.
 */
function groundedness(animation: Animation, pose: Pose): number {
  if ((animation.flags?.float ?? 0) !== 0) return 0;
  const airborne = clamp01(1 - Math.abs(pose.lift) / 8);
  const upright = clamp01(1 - Math.abs(pose.pitch) / 0.4);
  // Bassin a -80 debout, a -40 assis ou effondre.
  const standing = clamp01((-pose.joints.hip[1] - 55) / 15);
  return airborne * upright * standing;
}

/**
 * La pose affichee : l echantillon du contenu, plus le mouvement secondaire.
 *
 * `offsetSeconds` est le decalage de siege de `samplePose` ; il sert aussi de
 * phase a la respiration et au transfert de poids, pour que deux combattants
 * ne bougent pas a l unisson.
 */
export function livePose(
  animation: Animation,
  timeSeconds: number,
  offsetSeconds: number,
  options: SecondaryMotionOptions,
): Pose {
  const written = samplePose(animation, timeSeconds, offsetSeconds);
  const breathing = breatheInto(written, timeSeconds, offsetSeconds);
  if (options.reducedMotion) return breathing;

  const out = {} as Mutable;
  for (const name of JOINT_NAMES) {
    const j = breathing.joints[name];
    out[name] = [j[0], j[1], j[2]];
  }

  const grounded = groundedness(animation, written);
  const clock = timeSeconds + offsetSeconds;

  // --- transfert de poids : le bassin glisse, le buste suit, les pieds restent.
  const sway = Math.sin((clock / SWAY_PERIOD) * Math.PI * 2) * SWAY * grounded;
  out.hip[2] += sway;
  out.lk[2] += sway * 0.5;
  out.rk[2] += sway * 0.5;
  for (const name of UPPER) out[name][2] += sway * 0.8;

  // --- rebond des genoux, un nombre entier de fois par boucle : la couture
  // de la boucle tombe toujours sur le meme temps.
  if (animation.move.style === 'hype') {
    const beats = Math.max(1, Math.round(animation.loop.duration / BEAT));
    const progress = clock / animation.loop.duration;
    const depth = (BOUNCE_BASE + BOUNCE_HYPE * clamp01(options.hype)) * grounded;
    const dip = depth * (0.5 - 0.5 * Math.cos(progress * beats * Math.PI * 2));
    out.hip[1] += dip;
    for (const name of UPPER) out[name][1] += dip;
    for (const knee of ['lk', 'rk'] as const) {
      out[knee][1] += dip * 0.5;
      out[knee][0] += dip * KNEE_FORWARD;
    }
  }

  // --- suivi en retard : ce qui est au bout traine derriere ce qui le porte.
  const earlier = samplePose(animation, timeSeconds - LAG, offsetSeconds);
  const now = written.joints;
  const before = earlier.joints;
  addClamped(out.head, minus(before.neck, now.neck, HEAD_DRAG), DRAG_LIMIT);
  addClamped(out.lh, minus(before.le, now.le, HAND_DRAG), DRAG_LIMIT);
  addClamped(out.rh, minus(before.re, now.re, HAND_DRAG), DRAG_LIMIT);

  // Le regard rattrape le corps qui tourne, au lieu de tourner d un bloc avec lui.
  const turned = Math.atan2(
    Math.sin(written.rot - earlier.rot),
    Math.cos(written.rot - earlier.rot),
  );
  const look = Math.max(-LOOK_LIMIT, Math.min(LOOK_LIMIT, -turned * LOOK_DRAG));

  // --- la borne, garantie par construction plutot qu esperee.
  const joints = {} as Record<JointName, Joint3D>;
  for (const name of JOINT_NAMES) {
    const base = now[name];
    const moved: [number, number, number] = [base[0], base[1], base[2]];
    addClamped(moved, minus(out[name], base, 1), SECONDARY_REACH);
    joints[name] = moved;
  }

  return {
    joints,
    lift: written.lift,
    rot: written.rot,
    hy: written.hy + look,
    pitch: written.pitch,
  };
}
