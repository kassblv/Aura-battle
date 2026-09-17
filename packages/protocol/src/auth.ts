import { z } from 'zod';
import { parseFailure, toParseResult, type ParseResult } from './primitives.js';

/**
 * Contrat des routes REST d'authentification (docs/03, docs/04).
 *
 * Aura Battle se joue **sans inscription** : le premier lancement cree un
 * compte invite a partir d'un secret tire par l'appareil. Lier un compte Apple
 * ou Google viendra plus tard, par-dessus, sans rien deplacer.
 */

/**
 * Secret d'appareil : 32 octets aleatoires en hexadecimal.
 *
 * Le nom compte. Ce n'est pas un *identifiant* d'appareil — pas d'IDFV, pas de
 * numero de serie, pas d'empreinte : ces valeurs sont devinables ou lisibles
 * par d'autres applications, et celle-ci **vaut mot de passe**. Le client la
 * tire au premier lancement et la range dans le trousseau ; le serveur n'en
 * stocke que le hache.
 */
export const deviceSecretSchema = z
  .string()
  .regex(/^[0-9a-f]{64}$/, 'le secret d appareil doit faire 64 caracteres hexadecimaux');

export const authDeviceRequestSchema = z.strictObject({
  deviceSecret: deviceSecretSchema,
});

export const authRefreshRequestSchema = z.strictObject({
  refreshToken: z.string().min(1).max(512),
});

export const sessionResponseSchema = z.strictObject({
  accessToken: z.string().min(1),
  refreshToken: z.string().min(1),
  /** Duree de vie du jeton d'acces, en secondes. */
  expiresIn: z.number().int().positive(),
  player: z.strictObject({
    id: z.string().min(1).max(64),
    displayName: z.string().min(1).max(40),
    /** Vrai tant qu'aucune identite Apple ou Google n'est liee. */
    guest: z.boolean(),
  }),
});

export type AuthDeviceRequest = z.infer<typeof authDeviceRequestSchema>;
export type AuthRefreshRequest = z.infer<typeof authRefreshRequestSchema>;
export type SessionResponse = z.infer<typeof sessionResponseSchema>;

export function parseAuthDeviceRequest(payload: unknown): ParseResult<AuthDeviceRequest> {
  const parsed = authDeviceRequestSchema.safeParse(payload);
  return parsed.success ? toParseResult(parsed) : parseFailure(parsed.error);
}

export function parseAuthRefreshRequest(payload: unknown): ParseResult<AuthRefreshRequest> {
  const parsed = authRefreshRequestSchema.safeParse(payload);
  return parsed.success ? toParseResult(parsed) : parseFailure(parsed.error);
}
