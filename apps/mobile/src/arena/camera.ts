import { PerspectiveCamera } from 'three';
import type { AnimationShot } from '@aura/content';
import type { AnimationBounds } from '../animation/bounds.js';
import { clamp, damp } from './math.js';

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
  /**
   * Hauteur de la camera, en metres.
   *
   * Absente, la contre-plongee du ring s applique : la camera reste plus basse
   * que sa cible. C est le bon reglage pour un duel, ou l on veut que les deux
   * combattants dominent le cadre — et le mauvais pour une vitrine, ou le
   * joueur inspecte un geste et veut le voir de face, pas d en dessous.
   */
  readonly eyeY?: number;
}

/** Cadrage de match : les deux combattants tiennent dans l image. */
export function wideFraming(): CameraFraming {
  return { lookX: 0, lookY: 0.85, distance: REST_DISTANCE, orbit: 0 };
}

/** Hors match, un seul personnage a l ecran : on se rapproche. */
export function soloFraming(worldX: number): CameraFraming {
  return { lookX: worldX, lookY: 0.8, distance: 3.7, orbit: 0 };
}

/* ------------------------------------------------------------------ *
 * Vitrine : cadrer un meme pour qu il se lise
 * ------------------------------------------------------------------ */

/**
 * Part de la hauteur de l image occupee par le sujet.
 *
 * Moins que 1 : il faut de l air au-dessus de la tete et sous les pieds,
 * sinon le moindre debordement de l interpolation sort du cadre.
 */
const BODY_FILL = 0.82;
const BUST_FILL = 0.74;

/** En deca, la tete sort du cadre des que le joueur incline la camera. */
const MIN_PREVIEW_DISTANCE = 1.2;
/** Au-dela, le personnage se perd dans les gradins. */
const MAX_PREVIEW_DISTANCE = 7;

/** Le plan rapproche part juste sous le bassin. */
const BUST_BOTTOM_MARGIN = 0.06;

/** La camera ne descend jamais dans la plateforme, ni ne survole la scene. */
const MIN_EYE_Y = 0.35;
const MAX_EYE_ABOVE_SUBJECT = 0.9;

export interface PreviewFramingInput {
  /** Abscisse du personnage, en metres. */
  readonly worldX: number;
  /** Encombrement reel de l animation jouee (`animationBounds`). */
  readonly bounds: AnimationBounds;
  /** Plan demande par le contenu. Absent vaut `body`. */
  readonly shot?: AnimationShot | undefined;
  /** Orbite demandee par le joueur, en radians. */
  readonly orbit?: number;
  /** Elevation demandee par le joueur, en metres, relative au point vise. */
  readonly tilt?: number;
}

/**
 * Distance a laquelle un sujet de `height` metres remplit `fill` de l image.
 *
 * Seule la hauteur contraint : en paysage, l image est plus de deux fois plus
 * large que haute, et aucune de nos poses — T-pose comprise — n est plus large
 * que haute.
 *
 * `margin` recule la camera du rayon du sujet. Sans cela, le cadrage n est
 * juste que pour ce qui se trouve **sur l axe** du personnage : des que le
 * joueur tourne autour, un pied tendu vers la camera se retrouve un metre plus
 * pres, donc grossi, et sort du cadre. C est exactement ce qui coupait le pied
 * de la pose de defaite a un peu plus d un radian d orbite.
 */
export function distanceForHeight(height: number, fill: number, margin = 0): number {
  const visible = 2 * fill * Math.tan((CAMERA_FOV * Math.PI) / 360);
  return clamp(height / visible + margin, MIN_PREVIEW_DISTANCE, MAX_PREVIEW_DISTANCE);
}

/**
 * Cadrage de la vitrine : un seul personnage, qu on inspecte.
 *
 * La distance n est pas une constante mais une mesure : elle se deduit de
 * l encombrement reel de l animation. Le salto arriere recule la camera tout
 * seul, « Mewing » se rapproche parce que son fichier declare `bust`.
 */
export function previewFraming(input: PreviewFramingInput): CameraFraming {
  const { bounds } = input;
  const bust = input.shot === 'bust';

  const top = bounds.maxY;
  const bottom = bust ? Math.min(bounds.hipY - BUST_BOTTOM_MARGIN, top - 0.3) : bounds.minY;
  // Une hauteur nulle ou negative donnerait une distance nulle, donc une
  // camera dans le crane du personnage.
  const height = Math.max(0.3, top - bottom);
  const lookY = (top + bottom) / 2;

  return {
    lookX: input.worldX,
    lookY,
    distance: distanceForHeight(height, bust ? BUST_FILL : BODY_FILL, bounds.radius),
    orbit: input.orbit ?? 0,
    // A hauteur du milieu du sujet : on inspecte un geste, on ne le domine pas.
    eyeY: clamp(lookY + (input.tilt ?? 0), MIN_EYE_Y, top + MAX_EYE_ABOVE_SUBJECT),
  };
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

const TAU = Math.PI * 2;
/** Le plus court chemin autour du cercle : +170° a -170° fait 20°, pas 340°. */
const wrapAngle = (angle: number): number => angle - TAU * Math.round(angle / TAU);

export class ArenaCameraRig {
  private lookX = 0;
  private lookY = 0.85;
  private posX = 0;
  private posY = 1.4;
  private posZ = REST_DISTANCE;
  /**
   * L orbite et la distance sont suivies **separement**, puis recomposees.
   *
   * Amortir directement x et z, comme le faisait le portage initial, fait
   * couper les virages a la camera : sur une rotation rapide — un joueur qui
   * fait tourner son personnage a l accueil — elle prend la corde au lieu de
   * l arc et se rapproche du sujet de moitie. Amortir l angle garde le rayon
   * constant a n importe quelle vitesse.
   */
  private orbit = 0;
  private distance = REST_DISTANCE;

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
    this.orbit = wrapAngle(this.orbit + wrapAngle(orbit - this.orbit) * a);
    this.distance += (framing.distance - this.distance) * a;
    this.posX = this.lookX + Math.sin(this.orbit) * this.distance;
    this.posZ = Math.cos(this.orbit) * this.distance;
    // Sans hauteur imposee, la camera reste plus basse que sa cible : on
    // regarde les combattants legerement en contre-plongee, comme sur un ring.
    const eyeY = framing.eyeY ?? 0.55 + framing.lookY * 0.95;
    this.posY += (eyeY - this.posY) * a;

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
