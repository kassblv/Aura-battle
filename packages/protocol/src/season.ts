import { z } from 'zod';

/**
 * Le passe de saison (chantier n°6).
 *
 * Les recompenses de chaque palier sont du CONTENU (`SEASON_PASS`,
 * `@aura/content`) : le serveur n'envoie que ce qui depend du joueur — son XP,
 * ce qu'il a reclame, s'il a la piste premium — et la bourse apres coup, pour
 * que l'ecran n'ait rien a relire.
 *
 * Une reclamation ne porte que le palier et la piste : jamais ce qu'on y gagne
 * (regle d'or n°1).
 */

export const seasonTrackSchema = z.enum(['free', 'premium']);

/** Trente paliers au plus : la borne du protocole, pas celle du contenu. */
const tierSchema = z.number().int().min(1).max(30);

export const seasonStateSchema = z.strictObject({
  /** `null` quand aucune saison n'est en cours. */
  season: z
    .strictObject({
      number: z.number().int().positive(),
      endsAt: z.iso.datetime(),
    })
    .nullable(),
  xp: z.number().int().nonnegative(),
  tier: z.number().int().min(0).max(30),
  premium: z.boolean(),
  claimed: z.array(z.strictObject({ tier: tierSchema, track: seasonTrackSchema })).max(60),
  wallet: z.strictObject({
    soft: z.number().int().nonnegative(),
    hard: z.number().int().nonnegative(),
  }),
});

export type SeasonState = z.infer<typeof seasonStateSchema>;

export const seasonClaimRequestSchema = z.strictObject({
  tier: tierSchema,
  track: seasonTrackSchema,
});

export type SeasonClaimRequest = z.infer<typeof seasonClaimRequestSchema>;

export function parseSeasonClaimRequest(
  input: unknown,
): { success: true; data: SeasonClaimRequest } | { success: false; error: string } {
  const parsed = seasonClaimRequestSchema.safeParse(input);
  if (parsed.success) return { success: true, data: parsed.data };
  return { success: false, error: parsed.error.issues[0]?.message ?? 'charge invalide' };
}
