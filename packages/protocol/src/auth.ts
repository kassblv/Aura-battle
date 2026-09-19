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

/**
 * Nom affiche.
 *
 * Partage entre le client et le serveur a dessein : une seule liste de regles.
 * Le client s'en sert pour dire « non » avant l'aller-retour, le serveur pour
 * refuser ce qu'un client modifie ne demande pas — et les deux ne peuvent pas
 * diverger, ce qui produirait un formulaire qui accepte ce que le serveur
 * rejette.
 *
 * Les bornes ne sont pas arbitraires : deux caracteres pour qu'un nom reste un
 * nom, seize parce qu'au-dela il ne tient plus dans le bandeau de match sans
 * etre coupe — et un nom coupe en plein duel ne designe plus personne.
 */
export const DISPLAY_NAME_MIN = 2;
export const DISPLAY_NAME_MAX = 16;

export const displayNameSchema = z
  .string()
  .trim()
  .min(DISPLAY_NAME_MIN, 'le nom doit faire au moins 2 caracteres')
  .max(DISPLAY_NAME_MAX, 'le nom ne doit pas depasser 16 caracteres')
  // Lettres (accents compris), chiffres, espace, tiret, souligne, point. Le
  // premier caractere doit etre une lettre ou un chiffre.
  .regex(/^[\p{L}\p{N}][\p{L}\p{N} ._-]*$/u, 'caractere interdit dans le nom')
  // Deux espaces de suite servent a imiter le nom d'un autre joueur.
  .refine((name) => !/\s{2}/.test(name), 'espaces consecutifs interdits');

export const authRenameRequestSchema = z.strictObject({
  displayName: displayNameSchema,
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
export type AuthRenameRequest = z.infer<typeof authRenameRequestSchema>;
export type SessionResponse = z.infer<typeof sessionResponseSchema>;

export function parseAuthDeviceRequest(payload: unknown): ParseResult<AuthDeviceRequest> {
  const parsed = authDeviceRequestSchema.safeParse(payload);
  return parsed.success ? toParseResult(parsed) : parseFailure(parsed.error);
}

export function parseAuthRefreshRequest(payload: unknown): ParseResult<AuthRefreshRequest> {
  const parsed = authRefreshRequestSchema.safeParse(payload);
  return parsed.success ? toParseResult(parsed) : parseFailure(parsed.error);
}

export function parseAuthRenameRequest(payload: unknown): ParseResult<AuthRenameRequest> {
  const parsed = authRenameRequestSchema.safeParse(payload);
  return parsed.success ? toParseResult(parsed) : parseFailure(parsed.error);
}
