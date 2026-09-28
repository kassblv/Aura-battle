import { displayNameSchema } from '@aura/protocol';
import type { PlayerRecord, PlayerRepository } from '../domain/ports.js';

/**
 * Le profil du joueur : pour l'instant, son nom affiche.
 *
 * Separe de `SessionService`, qui s'occupe de jetons. Les deux partagent le
 * depot des joueurs mais ne repondent pas a la meme question — l'une dit « qui
 * es-tu », l'autre « comment veux-tu qu'on t'appelle ».
 */

export type ProfileFailure = 'INVALID_DISPLAY_NAME' | 'PLAYER_NOT_FOUND';

export class ProfileError extends Error {
  constructor(readonly reason: ProfileFailure) {
    super(reason);
    this.name = 'ProfileError';
  }
}

export interface ProfileDependencies {
  readonly players: PlayerRepository;
}

export class ProfileService {
  constructor(private readonly deps: ProfileDependencies) {}

  /**
   * Renomme un joueur.
   *
   * La validation vient de `@aura/protocol` : exactement les memes regles que
   * celles du formulaire. Un client modifie ne peut donc pas poser un nom que
   * l'interface refuse, et un jour ou l'autre ces regles bougeront en un seul
   * endroit.
   *
   * Aucune contrainte d'unicite. L'exiger transforme les pseudos en course a
   * la reservation et impose « Kassim1234 » a tous ceux qui arrivent apres :
   * l'identite d'un joueur est son identifiant, pas son nom.
   */
  async rename(playerId: string, displayName: string): Promise<PlayerRecord> {
    const parsed = displayNameSchema.safeParse(displayName);
    if (!parsed.success) {
      throw new ProfileError('INVALID_DISPLAY_NAME');
    }

    // On ecrit la valeur rognee par le schema, pas la saisie : sinon deux
    // joueurs nommes « Kassim » et « Kassim  » paraissent distincts et se
    // confondent a l'affichage.
    const renamed = await this.deps.players.rename(playerId, parsed.data);
    if (renamed === null) {
      throw new ProfileError('PLAYER_NOT_FOUND');
    }
    return renamed;
  }
}
