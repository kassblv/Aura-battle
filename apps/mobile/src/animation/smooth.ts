import { JOINT_NAMES, type JointName } from '@aura/content';
import type { Joint3D, Pose } from './pose.js';

/**
 * Lissage de pose (port du prototype, « Squelette fluide », seconde moitié).
 *
 * `samplePose` dit où le squelette **devrait** être à un instant donné. Ce
 * module dit où il est **réellement** : chaque articulation suit sa cible par
 * un ressort amorti, au lieu de s'y téléporter.
 *
 * C'est ce qui produit tout le moelleux du prototype, et surtout ce qui rend
 * les **changements d'animation** supportables : sans ressort, passer d'une
 * pose à l'autre est une coupure franche d'une image à la suivante. Le moteur
 * de jeu change d'animation à chaque révélation — c'est-à-dire au moment que
 * le joueur regarde le plus.
 *
 * L'état interne est mutable, donc ce module n'est pas pur ; il reste
 * déterministe, ce qui suffit à le tester. Aucune horloge n'est lue ici : le
 * pas de temps entre en paramètre.
 */

const TAU = Math.PI * 2;
const wrapAngle = (a: number): number => a - TAU * Math.round(a / TAU);

/**
 * Amortissement exponentiel, indépendant du pas de temps.
 *
 * `1 - exp(-rate * dt)` : deux pas de 8 ms rapprochent autant qu'un pas de
 * 16 ms. Un `facteur * dt` naïf ne tient pas cette promesse, et donne une
 * animation différente à 30 et à 120 images par seconde.
 */
const damp = (rate: number, dt: number): number => 1 - Math.exp(-rate * dt);

/**
 * Raideur relative de chaque articulation.
 *
 * Les extrémités — tête, mains, pieds — suivent avec un léger retard. Ce
 * décalage est la différence entre un corps entraîné par son mouvement et un
 * pantin dont tout bouge à l'instant.
 */
const JOINT_STIFFNESS: Readonly<Record<JointName, number>> = Object.freeze({
  head: 0.82,
  neck: 1,
  hip: 1,
  le: 0.95,
  lh: 0.8,
  re: 0.95,
  rh: 0.8,
  lk: 1,
  lf: 1.1,
  rk: 1,
  rf: 1.1,
});

/**
 * Pas d'intégration fixe, en secondes.
 *
 * Un ressort intégré avec le pas de temps réel change de comportement selon la
 * cadence d'affichage, et devient franchement instable dès qu'une image est
 * perdue. On découpe donc toujours en pas de 1/120 s : le résultat ne dépend
 * plus que du temps écoulé.
 */
const SUBSTEP = 1 / 120;

/**
 * Plafond du pas de temps, en secondes.
 *
 * Un onglet remis au premier plan livre un `dt` de plusieurs secondes. Le
 * rattraper entièrement ferait traverser l'écran au personnage, et coûterait
 * des centaines d'itérations dans l'image qui redémarre l'application.
 */
const MAX_DT = 0.25;

export interface SmoothingOptions {
  /** Pulsation du ressort. Plus haut, plus sec. */
  readonly stiffness?: number;
  /** Amortissement. 1 = critique, en dessous ça dépasse un peu. */
  readonly damping?: number;
}

export interface PoseSmoother {
  /** Avance d'un pas de temps et rend la pose lissée. */
  step(target: Pose, dtSeconds: number, options?: SmoothingOptions): Pose;
  /** Repose instantanément sur la cible : apparition, téléportation, reprise. */
  reset(target: Pose): void;
}

interface Axis3 {
  value: [number, number, number];
  velocity: [number, number, number];
}

export function createPoseSmoother(): PoseSmoother {
  const joints = new Map<JointName, Axis3>();
  let lift = 0;
  let rot = 0;
  let hy = 0;
  let pitch = 0;
  let started = false;

  function seed(target: Pose): void {
    for (const name of JOINT_NAMES) {
      const j = target.joints[name];
      joints.set(name, { value: [j[0], j[1], j[2]], velocity: [0, 0, 0] });
    }
    lift = target.lift;
    rot = target.rot;
    hy = target.hy;
    pitch = target.pitch;
    started = true;
  }

  function snapshot(): Pose {
    const out = {} as Record<JointName, Joint3D>;
    for (const name of JOINT_NAMES) {
      const state = joints.get(name);
      out[name] =
        state === undefined ? [0, 0, 0] : [state.value[0], state.value[1], state.value[2]];
    }
    // L'élévation reste bornée : le dépassement du ressort enfoncerait sinon le
    // personnage sous le sol à l'atterrissage d'un saut.
    return { joints: out, lift: Math.min(0, lift), rot, hy, pitch };
  }

  return {
    reset(target) {
      seed(target);
    },

    step(target, dtSeconds, options = {}) {
      if (!started) {
        // Première image : on naît sur la pose, on n'y glisse pas depuis
        // l'origine du monde.
        seed(target);
        return snapshot();
      }

      const dt = Math.max(0, Math.min(MAX_DT, dtSeconds));
      if (dt === 0) return snapshot();

      const w0 = options.stiffness ?? 26;
      const zeta = options.damping ?? 0.9;

      let remaining = dt;
      while (remaining > 1e-9) {
        const h = Math.min(remaining, SUBSTEP);
        remaining -= h;
        for (const name of JOINT_NAMES) {
          const state = joints.get(name);
          if (state === undefined) continue;
          const w = w0 * JOINT_STIFFNESS[name];
          const goal = target.joints[name];
          // Les trois axes sont ecrits un a un : indexer un tuple par une
          // variable rend chaque acces `number | undefined` sous
          // `noUncheckedIndexedAccess`, et le ressort se noierait dans les gardes.
          const spring = (axis: 0 | 1 | 2): void => {
            const v =
              state.velocity[axis] +
              (w * w * (goal[axis] - state.value[axis]) - 2 * zeta * w * state.velocity[axis]) * h;
            state.velocity[axis] = v;
            state.value[axis] += v * h;
          };
          spring(0);
          spring(1);
          spring(2);
        }
      }

      /**
       * L'élévation et les angles ne passent pas par un ressort.
       *
       * Un ressort dépasse, et un dépassement sur un angle fait vaciller le
       * personnage au repos — un défaut bien plus visible qu'une transition un
       * peu sèche. Les angles prennent en outre le plus court chemin, sans quoi
       * une boucle de +170° à −170° ferait un tour complet.
       */
      lift += (target.lift - lift) * damp(14, dt);
      rot = wrapAngle(rot + wrapAngle(target.rot - rot) * damp(20, dt));
      hy += wrapAngle(target.hy - hy) * damp(9, dt);
      pitch = wrapAngle(pitch + wrapAngle(target.pitch - pitch) * damp(26, dt));

      return snapshot();
    },
  };
}

/**
 * Respiration et micro-mouvements.
 *
 * Une pose fixe échantillonnée est parfaitement immobile, et une silhouette
 * parfaitement immobile se lit comme un bug d'affichage. Ces quelques
 * millimètres suffisent à la rendre vivante — c'est un décalage, pas une
 * animation : l'amplitude reste sous le millimètre à l'écran.
 *
 * `phase` décale un personnage par rapport à l'autre. Deux combattants qui
 * respirent à l'unisson se lisent comme des clones.
 */
export function breatheInto(pose: Pose, timeSeconds: number, phase: number): Pose {
  const t = timeSeconds;
  const breath = Math.sin(t * 2.1 + phase);
  const out = {} as Record<JointName, [number, number, number]>;
  for (const name of JOINT_NAMES) {
    const j = pose.joints[name];
    out[name] = [j[0], j[1], j[2]];
  }

  // Le contenu est en centimètres, y négatif vers le haut.
  out.neck[1] += breath * 0.9;
  out.head[1] += breath * 1.2;
  out.head[0] += Math.sin(t * 0.9 + phase) * 0.6;
  for (const arm of ['le', 'lh', 're', 'rh'] as const) out[arm][1] += breath * 0.7;
  out.lh[0] += Math.sin(t * 1.3 + phase) * 0.6;
  out.rh[0] += Math.sin(t * 1.1 + phase * 1.7) * 0.6;

  return {
    joints: out,
    lift: pose.lift,
    rot: pose.rot,
    hy: pose.hy,
    pitch: pose.pitch,
  };
}
