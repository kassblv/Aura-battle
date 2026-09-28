import type { SeatWearing } from '../application/match-runtime.js';

/**
 * Ce que porte un joueur, vu par le module `match`.
 *
 * Un port, pas une dependance vers l'inventaire : « match » n'a aucune raison
 * de connaitre une bourse, un catalogue ou un prix. Il a besoin d'une seule
 * chose — l'apparence a annoncer a l'adversaire au moment de la revelation.
 *
 * Lu **une fois a la connexion**, comme le nom et la ligue, et range dans le
 * registre des sessions. L'ouverture d'un match ne peut rien attendre : elle
 * doit pouvoir controler les sieges et les reserver sans point de suspension,
 * sinon deux appariements s'intercalent.
 */
export interface PlayerWardrobe {
  wearingOf(playerId: string): Promise<SeatWearing>;
}

/** Jeton d'injection : la passerelle depend du port, jamais de Prisma. */
export const PLAYER_WARDROBE = 'PLAYER_WARDROBE';
