import type { Animation } from '@aura/content';

/**
 * Mise en volume d un squelette dessine a plat.
 *
 * Les animations sont des dessins : onze articulations dans un plan, sans
 * epaisseur. Le rig en fait un corps en ecartant les membres de part et
 * d autre de l axe, en posant des epaules la ou le dessin n en a pas, et en
 * faisant pivoter le tout autour d un point de salto. Ces regles-la vivent
 * ici, et nulle part ailleurs.
 *
 * Pourquoi un module a part : `arena/rig.ts` les applique pour **dessiner**,
 * `animation/bounds.ts` les applique pour **cadrer**. Tant que les deux les
 * recopiaient, la vitrine cadrait un personnage plus etroit que celui qu elle
 * affichait — la T-pose, la toupie et le haussement d epaules debordaient
 * deja du cadre mesure avant que cette mesure n existe.
 *
 * Pur : aucune horloge, aucun Three.js. C est ce qui permet a `bounds` de
 * rester testable sans navigateur.
 */

/** Le contenu est en centimetres, y negatif vers le haut. */
export const CM = 0.01;

/**
 * Pivot de salto, en metres : a mi-corps, pas au sol.
 *
 * C est l axe d un salto, pas celui d une chute : tourner autour du sol
 * coucherait le personnage au lieu de le retourner.
 */
export const FLIP_PIVOT = 0.85;

/**
 * Ecartement des membres de part et d autre du corps, en metres.
 *
 * Les animations sont plates : les deux bras partagent le meme plan. Les
 * ecarter est ce qui transforme un dessin en volume — sans cela ils se
 * traversent proprement, et la pose devient illisible de trois quarts.
 */
export const DEPTH = 0.12;

/**
 * Demi-largeur d epaules, en metres.
 *
 * Le dessin n a pas d epaules : les bras partent du cou. Poser les deltoides
 * un peu plus au large que les coudes donne au buste une ligne d epaules
 * horizontale, au lieu d un V qui descend du cou vers les bras.
 */
export const SHOULDER_SPAN = 0.122;

/** Hauteur de l epaule sous l articulation du cou, en metres. */
export const SHOULDER_DROP = 0.019;

/** Demi-epaisseur du deltoide, perpendiculairement au bras. */
export const DELTOID_RADIUS = 0.067;

/** Demi-longueur du deltoide, le long du bras. */
/**
 * Longueur du deltoide le long du bras.
 *
 * Elle doit couvrir plus que la section du bras : le contour d'un os porte
 * `scale.y = 1.02`, donc son extremite depasse d'un pour cent de la LONGUEUR
 * de l'os au-dela de l'articulation. Sur un bras tendu — le salto arriere —
 * ce pour cent suffisait a faire sortir le contour du deltoide, et le raccord
 * montrait une marche. 0,069 laisse la marge.
 */
export const DELTOID_LENGTH = 0.069;

/** Glissement du deltoide le long du bras, depuis le point d epaule. */
export const DELTOID_OFFSET = 0.028;

/** Rayon de la trapeze qui relie les deux epaules, d avant en arriere. */
export const YOKE_DEPTH = 0.064;

/** Demi-epaisseur verticale de cette meme trapeze. */
export const YOKE_THICKNESS = 0.044;

/** Ecartement du coude, en part de `DEPTH`. */
const ELBOW = 1.05;

/** Ecartement de la main, en part de `DEPTH`. */
const HAND = 0.95;

/** Ecartement des mains quand les bras passent devant le corps. */
const HAND_CROSSED = 0.4;

/** Ecartement des mains quand les bras passent derriere le dos. */
const HAND_BEHIND = 0.35;

/** Ecartement des jambes, en part de `DEPTH`. */
const LEG = 0.55;

/** Recul en x des mains passees dans le dos, en metres. */
const BEHIND_HAND_SHIFT = -0.09;

/** Recul en x des coudes passes dans le dos, en metres. */
const BEHIND_ELBOW_SHIFT = -0.04;

/**
 * Profondeurs du squelette, pour un personnage tourne vers l avant.
 *
 * Signees : la chaine « gauche » (`le`/`lh`) passe derriere, la chaine
 * « droite » devant — sauf quand l animation croise les bras, auquel cas les
 * deux s inversent. L appelant multiplie par `facing`.
 */
export interface SkeletonDepths {
  readonly shoulderLeft: number;
  readonly shoulderRight: number;
  readonly elbowLeft: number;
  readonly elbowRight: number;
  readonly handLeft: number;
  readonly handRight: number;
  readonly hipLeft: number;
  readonly hipRight: number;
  readonly kneeLeft: number;
  readonly kneeRight: number;
  readonly footLeft: number;
  readonly footRight: number;
  /** Recul en x des mains et des coudes, quand les bras passent dans le dos. */
  readonly handShift: number;
  readonly elbowShift: number;
}

export function skeletonDepths(flags: Animation['flags']): SkeletonDepths {
  const back = -DEPTH;
  const front = DEPTH;

  let handLeft = back * HAND;
  let handRight = front * HAND;
  if (flags?.armsFront === true) {
    handLeft = front * HAND_CROSSED;
    handRight = back * HAND_CROSSED;
  }
  if (flags?.armsBack === true) {
    handLeft = back * HAND_BEHIND;
    handRight = front * HAND_BEHIND;
  }
  const behind = flags?.armsBack === true;

  return {
    shoulderLeft: -SHOULDER_SPAN,
    shoulderRight: SHOULDER_SPAN,
    elbowLeft: back * ELBOW,
    elbowRight: front * ELBOW,
    handLeft,
    handRight,
    hipLeft: back * LEG,
    hipRight: front * LEG,
    kneeLeft: back * LEG,
    kneeRight: front * LEG,
    footLeft: back * LEG,
    footRight: front * LEG,
    handShift: behind ? BEHIND_HAND_SHIFT : 0,
    elbowShift: behind ? BEHIND_ELBOW_SHIFT : 0,
  };
}
