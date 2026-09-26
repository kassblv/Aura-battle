/**
 * Recentrer le sujet quand un panneau lateral mange l ecran.
 *
 * En boutique et au vestiaire, la moitie gauche de l ecran n est **pas**
 * perdue : c est la que le personnage porte ce qu on essaie. Elargir le
 * panneau cacherait donc exactement ce qu on vient voir.
 *
 * `setViewOffset` decale la **projection**, pas la camera : le sujet se
 * deplace dans le cadre sans que l angle, la distance ni le cadrage changent.
 * Ce que le realisateur a compose reste compose — on ne fait que choisir
 * quelle partie du cadre l ecran montre.
 */

export interface ViewOffset {
  readonly fullWidth: number;
  readonly fullHeight: number;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/**
 * Part de l ecran au-dela de laquelle la zone libre devient trop etroite.
 *
 * Un personnage a besoin d une place pour se lire. Comprimer le sujet contre
 * un bord serait pire que de le laisser a moitie derriere le panneau : dans
 * le premier cas on croit voir, dans le second on sait qu on ne voit pas.
 */
const MAX_PANEL_SHARE = 0.65;

/**
 * Le decalage a appliquer, ou `null` s il n y a rien a faire.
 *
 * `null` couvre trois cas qui meritent tous le meme traitement : pas de
 * panneau, un panneau qui prend tout, et des dimensions absurdes — un ecran
 * replie pendant une rotation, par exemple.
 */
export function panelViewOffset(
  width: number,
  height: number,
  panelWidth: number,
): ViewOffset | null {
  if (!(width > 0) || !(height > 0)) return null;
  if (!(panelWidth > 0)) return null;
  if (panelWidth > width * MAX_PANEL_SHARE) return null;

  /*
    La moitie du panneau, et pas sa largeur entiere.

    Le sujet est au centre du cadre. Pour qu il finisse au centre de la zone
    libre, il doit se deplacer de la moitie de ce que le panneau occupe —
    (largeurLibre / 2) - (largeur / 2) vaut exactement -panneau / 2.
  */
  return {
    fullWidth: width,
    fullHeight: height,
    x: panelWidth / 2,
    y: 0,
    width,
    height,
  };
}
