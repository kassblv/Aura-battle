/**
 * Ou poser une orbe a l ecran (ADR 0008).
 *
 * Le moteur place ses orbes dans le carre unite : ce sont des coordonnees
 * abstraites, pas des pixels, et il n a pas a connaitre la forme d un
 * telephone. C est donc au client de les projeter la ou un pouce arrive.
 *
 * En paysage, tenu a deux mains, la zone atteignable est faite de deux arcs
 * partant des coins bas. Le centre haut est mort : une orbe qui y apparait est
 * une orbe qu on rate, ou qu on attrape en lachant l appareil.
 */

/** Bandeau du haut : score, energie, manche. Rien d interactif ne passe dessous. */
const TOP_BAND = 0.16;

/** Marge laterale : une cible collee au bord est coupee par l arrondi de l ecran. */
const SIDE_MARGIN = 0.06;

/** Bas de l ecran : les commandes de choix y vivent pendant l autre phase. */
const BOTTOM_MARGIN = 0.1;

/**
 * Ecart franc entre la zone atteignable et la zone morte.
 *
 * Les deux bandes ne doivent pas seulement ne pas se chevaucher : elles ne
 * doivent pas non plus s effleurer. A la couture exacte, le bruit flottant fait
 * basculer une orbe du mauvais cote — et c est precisement l orbe la plus
 * difficile a rattraper qui tombe alors hors de portee.
 */
const DEAD_ZONE_GAP = 0.04;

export const DEAD_ZONE = {
  /** Demi-largeur de la colonne centrale, en part de largeur d ecran. */
  halfWidth: 0.16,
  /** Au-dessus de cette hauteur, le centre est hors de portee. */
  below: 0.42,
} as const;

export interface ScreenPoint {
  /** Part de la largeur, depuis la gauche. */
  readonly left: number;
  /** Part de la hauteur, depuis le haut. */
  readonly top: number;
}

/**
 * Projette une orbe du moteur dans la zone atteignable.
 *
 * `x` decide du cote — l ordre horizontal du moteur est conserve, sinon une
 * sequence pensee pour alterner les mains cesserait de le faire. `y` decide de
 * l eloignement du coin : plus il est grand, plus l orbe s eloigne du pouce,
 * donc plus elle est difficile.
 */
export function reachable(x: number, y: number): ScreenPoint {
  const side = x < 0.5 ? -1 : 1;
  // Distance au coin, dans [0, 1] : on reutilise les deux moities de `x` pour
  // ne pas gaspiller la moitie de l information du moteur.
  const alongEdge = x < 0.5 ? x * 2 : (1 - x) * 2;

  const span = 0.5 - SIDE_MARGIN - DEAD_ZONE.halfWidth - DEAD_ZONE_GAP;
  const horizontal = SIDE_MARGIN + alongEdge * span;
  const left = side < 0 ? horizontal : 1 - horizontal;

  // Plus on monte, plus on se rapproche du bord : c est la forme de l arc.
  const height = TOP_BAND + y * (1 - TOP_BAND - BOTTOM_MARGIN);
  const top = 1 - BOTTOM_MARGIN - (height - TOP_BAND);

  return { left, top: Math.min(1 - BOTTOM_MARGIN, Math.max(TOP_BAND, top)) };
}
