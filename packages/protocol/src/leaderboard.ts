import { z } from 'zod';

/**
 * Le classement general (docs/05).
 *
 * En lecture seule, et en HTTP comme l'inventaire : on consulte un classement
 * hors match, et rien n'y est pousse — il n'y a donc rien a gagner a le faire
 * passer par la socket.
 */

const rowSchema = z.strictObject({
  rank: z.number().int().positive(),
  playerId: z.string().min(1).max(64),
  displayName: z.string().min(1).max(40),
  leaguePoints: z.number().int().min(0),
  league: z.string().min(1).max(32),
  wins: z.number().int().min(0),
  losses: z.number().int().min(0),
  /** Vrai pour la ligne de celui qui regarde. */
  isMe: z.boolean(),
});

export const leaderboardSchema = z.strictObject({
  top: z.array(rowSchema).max(200),
  /** Vide quand le joueur est deja visible dans la tete. */
  around: z.array(rowSchema).max(32),
  /** `null` pour qui n'a jamais fini de match classe. */
  me: rowSchema.nullable(),
});

export type LeaderboardRowPayload = z.infer<typeof rowSchema>;
export type LeaderboardPayload = z.infer<typeof leaderboardSchema>;
