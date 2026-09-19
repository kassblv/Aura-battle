import { PerspectiveCamera } from 'three';
import { damp } from './math.js';

/**
 * Camera de l arene, portee du prototype.
 *
 * Le cadrage se decrit (« regarde ici, a cette distance »), et la camera s y
 * rend en glissant. On separe les deux : les cadrages sont des fonctions pures,
 * le glissement est un petit etat qu on fait avancer image par image.
 */

export const CAMERA_FOV = 40;
export const CAMERA_NEAR = 0.1;
export const CAMERA_FAR = 90;

/** Distance de repos, camera au large sur les deux combattants. */
export const REST_DISTANCE = 4.7;
/** En deca, la camera entrerait dans le combattant. */
export const MIN_DISTANCE = 2.6;

export function createArenaCamera(aspect: number): PerspectiveCamera {
  const camera = new PerspectiveCamera(CAMERA_FOV, aspect, CAMERA_NEAR, CAMERA_FAR);
  camera.position.set(0, 1.4, REST_DISTANCE);
  return camera;
}

export interface CameraFraming {
  /** Point vise, en metres. */
  readonly lookX: number;
  readonly lookY: number;
  /** Distance entre la camera et ce point. */
  readonly distance: number;
  /** Decalage d orbite, en radians, ajoute a l oscillation d ambiance. */
  readonly orbit: number;
}

/** Cadrage de match : les deux combattants tiennent dans l image. */
export function wideFraming(): CameraFraming {
  return { lookX: 0, lookY: 0.85, distance: REST_DISTANCE, orbit: 0 };
}

/** Hors match, un seul personnage a l ecran : on se rapproche. */
export function soloFraming(worldX: number): CameraFraming {
  return { lookX: worldX, lookY: 0.8, distance: 3.7, orbit: 0 };
}

export interface CameraFocus {
  readonly worldX: number;
  readonly worldY: number;
  /** Sens dans lequel regarde le combattant : la camera passe legerement devant. */
  readonly facing: number;
  readonly zoom: number;
}

/**
 * Cadrage sur un combattant (revelation, victoire).
 *
 * La cible est ramenee vers le centre plutot que centree sur lui : l adversaire
 * reste visible au bord du cadre, ce qui garde la lecture du duel.
 */
export function focusFraming(focus: CameraFocus): CameraFraming {
  return {
    lookX: focus.worldX * 0.8,
    lookY: focus.worldY * 0.9 + 0.1,
    distance: distanceForZoom(focus.zoom),
    orbit: focus.facing * 0.07,
  };
}

export function distanceForZoom(zoom: number): number {
  return Math.max(MIN_DISTANCE, REST_DISTANCE - (zoom - 1) * 11);
}

export interface ArenaCameraInput {
  readonly framing: CameraFraming;
  /** Temps ecoule depuis le demarrage, en secondes. */
  readonly elapsed: number;
  /** Duree de l image, en secondes, hors ralenti : la camera ne ralentit pas. */
  readonly delta: number;
  /** Intensite de la secousse en cours, decroissante. */
  readonly shake: number;
  /** `prefers-reduced-motion` : coupe l oscillation d ambiance et la secousse. */
  readonly reducedMotion: boolean;
}

/** Vitesse de rattrapage du cadrage : plus haut, plus la camera colle. */
const FOLLOW_RATE = 2.4;

/** Amplitude d une secousse, en metres par unite de `shake`. */
const SHAKE_AMPLITUDE = 0.004;

export class ArenaCameraRig {
  private lookX = 0;
  private lookY = 0.85;
  private posX = 0;
  private posY = 1.4;
  private posZ = REST_DISTANCE;

  constructor(private readonly camera: PerspectiveCamera) {
    camera.position.set(this.posX, this.posY, this.posZ);
  }

  update(input: ArenaCameraInput): void {
    const { framing, elapsed, delta, reducedMotion } = input;

    // Oscillation lente : la scene respire meme quand rien ne bouge. Coupee
    // quand l utilisateur demande moins d animation.
    const ambientOrbit = reducedMotion ? 0 : Math.sin(elapsed * 0.13) * 0.1;
    const orbit = ambientOrbit + framing.orbit;

    const a = damp(FOLLOW_RATE, delta);
    this.lookX += (framing.lookX - this.lookX) * a;
    this.lookY += (framing.lookY - this.lookY) * a;
    this.posX += (framing.lookX + Math.sin(orbit) * framing.distance - this.posX) * a;
    this.posZ += (Math.cos(orbit) * framing.distance - this.posZ) * a;
    // La camera reste plus basse que sa cible : on regarde les combattants
    // legerement en contre-plongee, comme sur un ring.
    this.posY += (0.55 + framing.lookY * 0.95 - this.posY) * a;

    let shakeX = 0;
    let shakeY = 0;
    if (input.shake > 0 && !reducedMotion) {
      // Deux sinusoides premieres entre elles : le tremblement ne boucle pas.
      shakeX =
        input.shake *
        SHAKE_AMPLITUDE *
        (Math.sin(elapsed * 61) * 0.6 + Math.sin(elapsed * 37) * 0.4);
      shakeY =
        input.shake *
        SHAKE_AMPLITUDE *
        (Math.cos(elapsed * 53) * 0.6 + Math.sin(elapsed * 29) * 0.4);
    }

    this.camera.position.set(this.posX + shakeX, this.posY + shakeY, this.posZ);
    this.camera.lookAt(this.lookX + shakeX, this.lookY + shakeY, 0);
    this.camera.updateMatrixWorld();
  }
}
