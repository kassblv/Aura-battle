import { Vector3, type PerspectiveCamera } from 'three';

/**
 * Pont entre les deux reperes de l arene.
 *
 * Le jeu raisonne en pixels logiques (le calque 2D : orbes, textes, bandeaux),
 * la scene en metres. Le prototype fixe le taux de change une fois pour toutes ;
 * on le reprend pour que le rendu 3D et le calque 2D restent alignes.
 */

/** Un pixel logique vaut un centimetre dans la scene. */
export const METERS_PER_LOGIC_UNIT = 0.01;

/** Hauteur de reference : l echelle vaut 1 sur une fenetre de 330 px de haut. */
const REFERENCE_HEIGHT = 330;

/** Le sol est trace aux 84 % de la hauteur affichee. */
const GROUND_RATIO = 0.84;

export interface Viewport {
  readonly width: number;
  readonly height: number;
  /** Facteur d agrandissement du calque 2D. */
  readonly scale: number;
  /** Ordonnee du sol, en pixels logiques. */
  readonly groundY: number;
}

export function measureViewport(width: number, height: number): Viewport {
  // Une hauteur nulle arrive pendant une rotation d ecran : une echelle nulle
  // ferait diverger toutes les conversions en NaN ou en Infinity.
  const scale = Math.max(height, 1) / REFERENCE_HEIGHT;
  return { width, height, scale, groundY: height * GROUND_RATIO };
}

/** Horizontalement, l origine du monde est au centre de l ecran. */
export function toWorldX(px: number, viewport: Viewport): number {
  return ((px - viewport.width / 2) / viewport.scale) * METERS_PER_LOGIC_UNIT;
}

/** Verticalement, l origine est au sol, et l axe est retourne. */
export function toWorldY(py: number, viewport: Viewport): number {
  return ((viewport.groundY - py) / viewport.scale) * METERS_PER_LOGIC_UNIT;
}

export interface ScreenPoint {
  readonly x: number;
  readonly y: number;
  /** Profondeur normalisee : au-dela de 1, le point est hors champ (derriere). */
  readonly depth: number;
}

// Reutilise a chaque projection : le calque 2D en fait une par texte flottant.
const scratch = new Vector3();

/**
 * Reprojette un point logique la ou il apparait a l ecran.
 *
 * C est ce qui permet au calque 2D d accrocher un « +18 aura » au-dessus de la
 * tete d un combattant alors que la camera bouge.
 */
export function projectLogicToScreen(
  camera: PerspectiveCamera,
  viewport: Viewport,
  px: number,
  py: number,
  worldZ = 0,
): ScreenPoint {
  scratch.set(toWorldX(px, viewport), toWorldY(py, viewport), worldZ).project(camera);
  return {
    x: (scratch.x * 0.5 + 0.5) * viewport.width,
    y: (-scratch.y * 0.5 + 0.5) * viewport.height,
    depth: scratch.z,
  };
}
