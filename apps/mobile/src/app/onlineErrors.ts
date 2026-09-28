import type { ErrorCode } from '@aura/protocol';

/**
 * Codes qui AVERTISSENT sans rien refuser.
 *
 * `COSMETIC_NOT_OWNED` : le verrouillage a eu lieu, avec la pose offerte de la
 * case (protocole 2.0.0). Il n'y a rien a corriger pour le joueur ; rangee
 * comme une erreur, elle s'affichait plus tard sur l'ecran d'invitation, hors
 * contexte et en texte technique.
 */
const WARNINGS: ReadonlySet<string> = new Set<ErrorCode>(['COSMETIC_NOT_OWNED']);

/** Le texte a montrer au joueur pour une erreur du serveur, ou `null` s'il n'y a rien a montrer. */
export function onlineErrorText(code: string, message: string): string | null {
  return WARNINGS.has(code) ? null : message;
}
