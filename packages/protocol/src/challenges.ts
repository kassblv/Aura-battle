import { z } from 'zod';

/**
 * Defis quotidiens (docs/01 §11, jalon M8).
 *
 * Le serveur envoie tout ce que l'ecran affiche — nom, cible, recompense —
 * plutot que de laisser le client le retrouver dans `@aura/content`. Deux
 * raisons, et la seconde compte plus que la premiere :
 *
 * - un client plus ancien que le catalogue afficherait un identifiant nu a la
 *   place d'un nom ;
 * - surtout, la progression et la cible viennent alors de la MEME reponse.
 *   Mesurees de deux cotes differents, elles finiraient par se contredire —
 *   une barre pleine sur un defi que le serveur refuse d'encaisser.
 */

export const challengeViewSchema = z.strictObject({
  id: z.string().min(1).max(64),
  name: z.string().min(1).max(80),
  progress: z.number().int().nonnegative(),
  target: z.number().int().positive(),
  reward: z.number().int().positive(),
  done: z.boolean(),
  claimed: z.boolean(),
});

export type ChallengeView = z.infer<typeof challengeViewSchema>;

/** Au plus une poignee : borner rend une anomalie visible a l'arrivee. */
export const dailyChallengesSchema = z.strictObject({
  challenges: z.array(challengeViewSchema).max(16),
});

export type DailyChallenges = z.infer<typeof dailyChallengesSchema>;

/** La reponse d'un encaissement : ce qu'on gagne, et l'etat qui en resulte. */
export const challengeClaimSchema = z.strictObject({
  reward: z.number().int().positive(),
  challenges: z.array(challengeViewSchema).max(16),
});

export type ChallengeClaim = z.infer<typeof challengeClaimSchema>;

export const challengeClaimRequestSchema = z.strictObject({
  challengeId: z.string().min(1).max(64),
});

export function parseChallengeClaimRequest(input: unknown):
  | { success: true; data: z.infer<typeof challengeClaimRequestSchema> }
  | {
      success: false;
      error: string;
    } {
  const parsed = challengeClaimRequestSchema.safeParse(input);
  if (parsed.success) return { success: true, data: parsed.data };
  return { success: false, error: parsed.error.issues[0]?.message ?? 'charge invalide' };
}
