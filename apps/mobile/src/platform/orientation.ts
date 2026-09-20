/**
 * Verrouillage en paysage.
 *
 * ADR 0008 : le jeu se joue en paysage, a deux mains. L avertissement
 * « tourne ton telephone » DEMANDE au joueur de basculer ; ce module l impose
 * quand la plateforme le permet. Les deux sont necessaires : le verrou n est
 * disponible nulle part de facon fiable, et l avertissement ne sert a rien une
 * fois le verrou pris.
 *
 * Le refus est le cas NORMAL, pas une panne : les navigateurs de bureau
 * n implementent pas `lock`, et sur mobile il exige generalement le plein
 * ecran. On l avale donc en silence — une alerte dans la console a chaque
 * demarrage apprendrait a l ignorer.
 *
 * Capacitor n est pas encore installe. Quand il le sera, son greffon
 * d orientation prendra la place de cet appel sans rien changer aux appelants :
 * c est pour ca que la decision vit ici et pas dans un composant.
 */

/** Le strict necessaire de `screen.orientation`, pour pouvoir le simuler. */
export interface OrientationLike {
  readonly type?: string;
  readonly lock?: (orientation: string) => Promise<void>;
}

/** Renvoie l API d orientation de la plateforme, ou `null` hors navigateur. */
export function defaultOrientation(): OrientationLike | null {
  const candidate = (globalThis as { screen?: { orientation?: OrientationLike } }).screen
    ?.orientation;
  return candidate ?? null;
}

/**
 * Tente le verrou, et dit s il a ete obtenu.
 *
 * On verrouille meme deja en paysage : le but n est pas d y arriver, c est d y
 * RESTER. Sans cela, un joueur qui bascule en pleine manche perd l arene au
 * moment precis ou il vise.
 */
export async function lockLandscape(
  orientation: OrientationLike | null = defaultOrientation(),
): Promise<boolean> {
  const lock = orientation?.lock;
  if (lock === undefined) return false;
  try {
    await lock.call(orientation, 'landscape');
    return true;
  } catch {
    // Refus attendu : pas de verrou sur cette plateforme, ou plein ecran exige.
    return false;
  }
}
