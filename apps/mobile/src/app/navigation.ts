/**
 * Ou se trouve le joueur dans l application.
 *
 * Une machine a etats minuscule, mais une machine a etats quand meme : la
 * navigation porte deux regles qu on ne veut pas voir eparpillees dans des
 * `onClick`, et une regle eparpillee est une regle qu on oublie.
 */

export type Screen =
  | 'home'
  | 'profile'
  | 'leaderboard'
  | 'challenges'
  | 'settings'
  | 'wardrobe'
  | 'shop'
  | 'queue'
  | 'invite'
  | 'match';

export interface Navigation {
  readonly screen: Screen;
  /** Vrai entre le debut d un match et son resultat. */
  readonly matchRunning: boolean;
}

/** Un jeu qui demarre dans une partie non demandee vole le premier geste. */
export function openingScreen(): Navigation {
  return { screen: 'home', matchRunning: false };
}

/**
 * Peut-on quitter l ecran courant sans consequence ?
 *
 * Quitter en pleine manche, c est un forfait. Cela se demande, cela ne se fait
 * pas d un appui de travers sur un bouton de navigation.
 */
export function canLeave(state: Navigation): boolean {
  return !state.matchRunning;
}

export function navigate(state: Navigation, to: Screen): Navigation {
  if (to === state.screen) return state;

  /**
   * Le vestiaire reste ferme pendant une manche.
   *
   * Regle d or n°3 : un cosmetique ne touche jamais un score — on ferme donc la
   * porte au moment ou la question pourrait se poser. Accessoirement, un
   * panneau de vestiaire en pleine manche recouvrirait les commandes.
   */
  // Le vestiaire et la boutique restent fermes pendant une manche.
  if ((to === 'wardrobe' || to === 'shop') && state.matchRunning) return state;

  /**
   * On ne cherche pas d adversaire quand on en a deja un.
   *
   * Chercher n est pas jouer — la recherche ne compte donc pas comme un match
   * en cours, et on peut l annuler. Mais une fois la manche ouverte, la file
   * n est plus un endroit ou revenir : y retourner laisserait le joueur devant
   * un compte a rebours pendant que sa partie se joue sans lui.
   */
  if ((to === 'queue' || to === 'invite') && state.matchRunning) return state;

  if (to === 'match') return { screen: 'match', matchRunning: true };
  return { screen: to, matchRunning: false };
}
