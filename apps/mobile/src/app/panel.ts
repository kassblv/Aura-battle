/**
 * La largeur du panneau de boutique et de vestiaire.
 *
 * Ces deux ecrans sont les seuls ou la moitie gauche n est **pas** perdue :
 * c est la que le personnage porte ce qu on essaie. Le panneau y arbitre donc
 * entre deux choses qu on veut toutes les deux voir — la liste et l etalage —
 * et cet arbitrage se decide ici, une fois.
 *
 * Une fois, parce que trois endroits en dependent : la largeur reellement
 * posee sur le panneau, le nombre de colonnes d articles, et le decalage de
 * projection qui recentre le personnage dans ce qui reste
 * (`arena/panelOffset.ts`). Ecrite en CSS, la decision aurait ete invisible
 * aux deux autres, et un `min()` recopie a la main derive au premier
 * changement.
 */

export interface PanelLayout {
  /** Largeur du panneau, en pixels de mise en page. */
  readonly width: number;
  /** Nombre de colonnes d articles qui y tiennent. */
  readonly columns: number;
}

/**
 * Le plafond.
 *
 * Un article demande environ 240 pixels pour montrer sa pastille, son nom
 * entier et son prix. Au-dela de deux colonnes, la liste s etire au lieu de
 * se densifier — on ferait reculer le personnage sans rien gagner.
 */
export const PANEL_MAX_WIDTH = 520;

/** La part de l ecran que le panneau peut prendre quand la place abonde. */
export const PANEL_SHARE = 0.62;

/**
 * Ce qui revient au personnage, quoi qu il arrive.
 *
 * Un plancher, pas un reste : sous cette largeur, une tenue ne se distingue
 * plus d une autre et la boutique redevient la grille de vignettes qu elle
 * essaie de ne pas etre. Quand l ecran manque, on prend au panneau.
 */
export const PANEL_MIN_FREE = 300;

/** Sous cette largeur, le panneau est deja etroit : on ne le rogne pas plus. */
export const PANEL_MIN_WIDTH = 260;

/** A partir d ici, deux colonnes tiennent sans couper les noms. */
export const PANEL_TWO_COLUMNS = 420;

export function panelLayout(viewportWidth: number): PanelLayout {
  // Un ecran replie pendant une rotation, ou une mesure prise avant la
  // premiere mise en page : on rend le plancher plutot qu un NaN qui
  // traverserait le CSS sans bruit et ferait disparaitre le panneau.
  if (!(viewportWidth > 0)) return { width: PANEL_MIN_WIDTH, columns: 1 };

  const width = Math.floor(
    Math.max(
      PANEL_MIN_WIDTH,
      Math.min(PANEL_MAX_WIDTH, viewportWidth * PANEL_SHARE, viewportWidth - PANEL_MIN_FREE),
    ),
  );

  return { width, columns: width >= PANEL_TWO_COLUMNS ? 2 : 1 };
}
