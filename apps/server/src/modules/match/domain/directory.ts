/**
 * Port d'annuaire des joueurs.
 *
 * Le module `match` a besoin d'une seule chose du module `auth` : le nom
 * affiche d'un joueur, pour l'annoncer a son adversaire. Passer par un port
 * plutot que d'importer le depot d'`auth` garde les deux modules separables —
 * et dit noir sur blanc que `match` ne connait rien d'autre d'un joueur.
 */
export interface PlayerDirectory {
  /**
   * Noms affiches des joueurs demandes, indexes par identifiant.
   *
   * Une seule requete pour les deux sieges : deux allers-retours a la base au
   * moment precis ou un match s'ouvre, c'est deux fois plus d'occasions de
   * faire attendre les deux joueurs.
   *
   * Un joueur absent de la reponse n'est pas une erreur — un compte peut
   * disparaitre entre le debut du match et cette lecture.
   */
  displayNames(playerIds: readonly string[]): Promise<ReadonlyMap<string, string>>;
}

/** Nom montre quand l'annuaire ne sait pas repondre. */
export const UNKNOWN_PLAYER_NAME = 'Adversaire';

/**
 * Jeton d'injection du port.
 *
 * Une interface TypeScript disparait a la compilation : Nest ne peut pas s'en
 * servir comme cle. Le jeton doit donc exister a l'execution — et vivre ici,
 * a cote du contrat, plutot qu'en chaine recopiee dans chaque module et chaque
 * test, ou une faute de frappe ne se voit qu'au premier appel.
 */
export const PLAYER_DIRECTORY = 'PLAYER_DIRECTORY';
