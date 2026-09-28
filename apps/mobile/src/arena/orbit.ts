import { clamp, damp } from './math.js';

/**
 * Faire tourner son personnage au doigt (vitrine de l accueil).
 *
 * Une manipulation directe : le doigt entraine le **personnage**, pas la
 * camera. Glisser vers la droite fait tourner le personnage vers la droite,
 * donc la camera part vers la gauche. Glisser vers le bas bascule le haut du
 * corps vers soi, donc la camera monte. C est la convention d un objet qu on
 * retourne dans la main, pas celle d un cameraman.
 *
 * Volontairement sans DOM ni Three.js : ce module ne recoit que des positions
 * et des durees. L ecoute des evenements de pointeur vit dans `useArena`, la
 * camera dans `camera.ts` — et toute la partie qui decide d un angle se teste
 * sans navigateur.
 */

export interface OrbitOptions {
  /** Radians parcourus en glissant sur toute la largeur. */
  readonly yawPerWidth?: number;
  /** Metres d elevation en glissant sur toute la hauteur. */
  readonly tiltPerHeight?: number;
  /** Elevation minimale, en metres : la camera ne passe pas sous la plateforme. */
  readonly minTilt?: number;
  /** Elevation maximale : au-dela on regarde un crane, plus un personnage. */
  readonly maxTilt?: number;
  /** Vitesse d inertie maximale, en radians par seconde. */
  readonly maxSpin?: number;
  /** Retombee de l inertie, par seconde. */
  readonly decay?: number;
}

export interface OrbitPointer {
  readonly id: number;
  readonly x: number;
  readonly y: number;
}

export interface OrbitControl {
  /** Angle d orbite, en radians, dans `[-pi, pi]`. */
  readonly yaw: number;
  /** Elevation de la camera, en metres, relative au point vise. */
  readonly tilt: number;
  readonly dragging: boolean;
  /** Vrai des que le doigt a franchi le seuil du glissement. */
  readonly moved: boolean;
  setViewport(width: number, height: number): void;
  start(pointer: OrbitPointer): void;
  move(pointer: OrbitPointer): void;
  end(id: number): void;
  /** `pointercancel`, perte de capture, mise en arriere-plan. */
  cancel(): void;
  update(deltaSeconds: number): void;
  /** Retour a l angle de repos, sans inertie. */
  reset(): void;
}

/**
 * Un glissement de toute la largeur fait un peu moins d un demi-tour.
 *
 * Plus sensible, on depasse le dos du personnage d un coup de pouce et on ne
 * sait plus ou on en est ; moins, il faut trois gestes pour faire le tour.
 */
const YAW_PER_WIDTH = 2.8;
const TILT_PER_HEIGHT = 1.6;

/**
 * Bornes d elevation, en metres autour du point vise.
 *
 * En bas : la camera reste au-dessus de la plateforme — passer dessous
 * montrerait le personnage a travers le sol. En haut : une plongee plus forte
 * ecrase la silhouette, et un geste ecrase ne se lit plus.
 */
const MIN_TILT = -0.5;
const MAX_TILT = 0.9;

/**
 * Plafond de l inertie, en radians par seconde.
 *
 * La camera suit son cadrage par amortissement ; au-dela de cette vitesse elle
 * ne tiendrait plus l arc, et le rayon se mettrait a respirer. C est aussi une
 * limite de lisibilite : un personnage qui tourne plus vite que cela n est plus
 * inspectable.
 */
const MAX_SPIN = 3.2;

/** Retombee de l inertie : environ une seconde et demie de roue libre. */
const DECAY = 2.2;

/** En dessous, on considere la rotation finie plutot que de la voir ramper. */
const SPIN_EPSILON = 0.02;

/** Lissage de la vitesse pendant le glissement : une image erratique ne lance pas la toupie. */
const VELOCITY_SMOOTHING = 18;

/** Au-dela, c est un glissement ; en deca, c est un appui. */
const DRAG_THRESHOLD_PX = 6;

const TAU = Math.PI * 2;
const wrapAngle = (angle: number): number => angle - TAU * Math.round(angle / TAU);

export function createOrbitControl(options: OrbitOptions = {}): OrbitControl {
  const yawPerWidth = options.yawPerWidth ?? YAW_PER_WIDTH;
  const tiltPerHeight = options.tiltPerHeight ?? TILT_PER_HEIGHT;
  const minTilt = options.minTilt ?? MIN_TILT;
  const maxTilt = options.maxTilt ?? MAX_TILT;
  const maxSpin = options.maxSpin ?? MAX_SPIN;
  const decay = options.decay ?? DECAY;

  let width = 1;
  let height = 1;

  let yaw = 0;
  let tilt = 0;
  let spin = 0;
  let rise = 0;

  /** Pointeur qui mene la danse ; les autres sont ignores. */
  let activeId: number | null = null;
  let lastX = 0;
  let lastY = 0;
  let travelled = 0;
  let moved = false;
  /** Deplacement accumule depuis la derniere image, pour en deduire la vitesse. */
  let frameYaw = 0;
  let frameTilt = 0;

  return {
    get yaw() {
      return yaw;
    },
    get tilt() {
      return tilt;
    },
    get dragging() {
      return activeId !== null;
    },
    get moved() {
      return moved;
    },

    setViewport(nextWidth, nextHeight): void {
      // Une fenetre repliee (rotation d ecran) donnerait une sensibilite
      // infinie au premier glissement d apres.
      width = Math.max(1, nextWidth);
      height = Math.max(1, nextHeight);
    },

    start(pointer): void {
      /**
       * Un seul doigt commande.
       *
       * Deux doigts poses ensemble sur l arene enverraient chacun leur
       * deplacement : le personnage tournerait deux fois plus vite, et un
       * pincement le ferait partir en vrille.
       */
      if (activeId !== null) return;
      activeId = pointer.id;
      lastX = pointer.x;
      lastY = pointer.y;
      travelled = 0;
      moved = false;
      // Saisir une rotation en cours l arrete net, comme on pose la main sur
      // un disque qui tourne.
      spin = 0;
      rise = 0;
    },

    move(pointer): void {
      if (pointer.id !== activeId) return;
      const dx = pointer.x - lastX;
      const dy = pointer.y - lastY;
      lastX = pointer.x;
      lastY = pointer.y;

      travelled += Math.abs(dx) + Math.abs(dy);
      if (travelled > DRAG_THRESHOLD_PX) moved = true;

      // Manipulation directe : le personnage suit le doigt, donc la camera
      // part en sens inverse.
      const dYaw = -(dx / width) * yawPerWidth;
      const dTilt = (dy / height) * tiltPerHeight;

      yaw = wrapAngle(yaw + dYaw);
      const clamped = clamp(tilt + dTilt, minTilt, maxTilt);
      frameYaw += dYaw;
      // Ce qui a ete rogne par les bornes ne doit pas nourrir l inertie :
      // sinon la camera « rebondit » sur la limite des qu on lache.
      frameTilt += clamped - tilt;
      tilt = clamped;
    },

    end(id): void {
      if (id !== activeId) return;
      activeId = null;
    },

    cancel(): void {
      activeId = null;
      moved = false;
      spin = 0;
      rise = 0;
    },

    update(delta): void {
      if (delta <= 0) return;

      if (activeId !== null) {
        // Pendant le glissement, l angle a deja bouge : on ne fait que mesurer
        // la vitesse, lissee, pour savoir quoi lancer a la relache.
        const smoothing = damp(VELOCITY_SMOOTHING, delta);
        spin += (frameYaw / delta - spin) * smoothing;
        rise += (frameTilt / delta - rise) * smoothing;
        frameYaw = 0;
        frameTilt = 0;
        spin = clamp(spin, -maxSpin, maxSpin);
        return;
      }

      if (spin === 0 && rise === 0) return;

      yaw = wrapAngle(yaw + spin * delta);
      const clamped = clamp(tilt + rise * delta, minTilt, maxTilt);
      // Arrive en butee, l elevation cesse : laisser la vitesse vivre ferait
      // repartir la camera a la seconde ou le joueur reprend le doigt.
      if (clamped === tilt) rise = 0;
      tilt = clamped;

      const fall = damp(decay, delta);
      spin -= spin * fall;
      rise -= rise * fall;
      if (Math.abs(spin) < SPIN_EPSILON) spin = 0;
      if (Math.abs(rise) < SPIN_EPSILON) rise = 0;
    },

    reset(): void {
      yaw = 0;
      tilt = 0;
      spin = 0;
      rise = 0;
      frameYaw = 0;
      frameTilt = 0;
      activeId = null;
      moved = false;
    },
  };
}
