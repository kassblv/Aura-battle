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

/**
 * Saisie d'un code de recuperation.
 *
 * Le schema borne la **saisie**, pas le code. Un joueur recopie le sien avec
 * des tirets, des espaces, parfois le prefixe, parfois rien de tout ca : c'est
 * le serveur qui normalise ensuite. Une borne serree ici refuserait des codes
 * valables avant que quiconque les regarde.
 *
 * Bornee quand meme : sans plafond, un client envoie un megaoctet par
 * tentative. Le protocole borne un message, et celui-ci n'y echappe pas.
 */
export const recoveryCodeInputSchema = z.string().trim().min(1).max(64);

export const authRecoveryClaimRequestSchema = z.strictObject({
  code: recoveryCodeInputSchema,
});

/**
 * Rattachement de l'appareil courant au compte que l'on vient de retrouver.
 *
 * Meme schema que l'ouverture de session : c'est le meme genre de secret, avec
 * les memes exigences. Une seule definition, donc aucune chance que les deux
 * divergent.
 */
export const authDeviceLinkRequestSchema = z.strictObject({
  deviceSecret: deviceSecretSchema,
});

/**
 * Le code delivre, sous sa forme affichable.
 *
 * `strictObject` : le hache n'a aucune raison de sortir du serveur, et un
 * schema ferme est ce qui empeche qu'il sorte un jour par distraction.
 */
export const recoveryCodeResponseSchema = z.strictObject({
  code: z.string().min(1).max(64),
});

/**
 * Email et mot de passe : retrouver son compte depuis un autre appareil.
 *
 * L'adresse est un **identifiant**, pas un canal : le serveur n'envoie aucun
 * courrier et ne la verifie pas. Un mot de passe oublie se rattrape par le code
 * de recuperation, qui reste la preuve de secours.
 *
 * Le schema porte les **formes** — adresse lisible, longueur du mot de passe.
 * La regle metier (mots de passe trop courants, egal a l'adresse) vit cote
 * serveur : c'est la qu'est la liste, et elle n'a rien a faire dans le client.
 */
export const EMAIL_MAX = 254;
export const PASSWORD_MIN = 8;
/**
 * Plafond du mot de passe. Pas une coquetterie : le hachage coute un temps de
 * calcul qui depend de l'entree, et sans borne un client envoie un megaoctet
 * par tentative.
 */
export const PASSWORD_MAX = 128;

/**
 * Adresse, rognee et en minuscules **avant** d'etre verifiee.
 *
 * Normaliser ici, c'est garantir que le client et le serveur parlent de la
 * meme chaine : sinon « Kassim@Gmail.com » et « kassim@gmail.com » ouvriraient
 * deux comptes, et le joueur ne retrouverait pas le sien selon la facon dont
 * son clavier a pose la majuscule.
 */
export const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .pipe(z.email('adresse email invalide').max(EMAIL_MAX));

/**
 * Mot de passe **choisi** : la politique de longueur s'applique.
 *
 * Jamais rogne : un espace fait partie du mot de passe, et le retirer en
 * silence changerait le secret que le joueur croit avoir choisi.
 */
export const newPasswordSchema = z
  .string()
  .min(PASSWORD_MIN, 'au moins 8 caracteres')
  .max(PASSWORD_MAX, '128 caracteres au maximum');

/**
 * Mot de passe **presente** : seulement borne.
 *
 * La politique de choix peut se durcir un jour ; un joueur doit encore entrer
 * avec le mot de passe qu'il avait choisi sous l'ancienne regle.
 */
export const presentedPasswordSchema = z.string().min(1).max(PASSWORD_MAX);

export const authEmailLinkRequestSchema = z.strictObject({
  email: emailSchema,
  password: newPasswordSchema,
});

export const authEmailLoginRequestSchema = z.strictObject({
  email: emailSchema,
  password: presentedPasswordSchema,
});

/**
 * Changer son mot de passe : une preuve, et une seule.
 *
 * L'ancien mot de passe, ou le code de recuperation — c'est le chemin du mot
 * de passe oublie, puisqu'aucun courrier ne part jamais. Les deux a la fois
 * sont refuses : une requete ambigue dit seulement qu'un client ne sait pas ce
 * qu'il fait.
 */
export const authEmailPasswordRequestSchema = z
  .strictObject({
    currentPassword: presentedPasswordSchema.optional(),
    recoveryCode: recoveryCodeInputSchema.optional(),
    newPassword: newPasswordSchema,
  })
  .refine(
    (body) => (body.currentPassword === undefined) !== (body.recoveryCode === undefined),
    'une preuve et une seule : ancien mot de passe ou code de recuperation',
  );

/**
 * Ce que le client sait de l'adresse rattachee : si elle existe, et sa forme
 * **masquee** (`k•••@gmail.com`). Assez pour que le joueur reconnaisse la
 * sienne, pas assez pour qu'un ecran photographie la publie. `strictObject` :
 * le hache n'a aucune raison de sortir, et un schema ferme l'en empeche.
 */
export const emailStatusResponseSchema = z.strictObject({
  linked: z.boolean(),
  maskedEmail: z.string().min(1).max(EMAIL_MAX).nullable(),
});

/**
 * Les refus que le client sait expliquer, dans le champ `code` du corps.
 *
 * `INVALID_CREDENTIALS` est **un seul** code pour « adresse inconnue » et
 * « mauvais mot de passe » : deux reponses distinctes diraient a qui essaie
 * des adresses lesquelles ont un compte.
 */
export const AUTH_ERROR_CODES = [
  'INVALID_CREDENTIALS',
  'EMAIL_UNAVAILABLE',
  'EMAIL_ALREADY_LINKED',
  'EMAIL_NOT_LINKED',
  'PASSWORD_TOO_COMMON',
  'PASSWORD_MATCHES_EMAIL',
  'TOO_MANY_ATTEMPTS',
] as const;

export type AuthErrorCode = (typeof AUTH_ERROR_CODES)[number];

export type AuthDeviceRequest = z.infer<typeof authDeviceRequestSchema>;
export type AuthRecoveryClaimRequest = z.infer<typeof authRecoveryClaimRequestSchema>;
export type AuthDeviceLinkRequest = z.infer<typeof authDeviceLinkRequestSchema>;
export type RecoveryCodeResponse = z.infer<typeof recoveryCodeResponseSchema>;
export type AuthRefreshRequest = z.infer<typeof authRefreshRequestSchema>;
export type AuthRenameRequest = z.infer<typeof authRenameRequestSchema>;
export type SessionResponse = z.infer<typeof sessionResponseSchema>;
export type AuthEmailLinkRequest = z.infer<typeof authEmailLinkRequestSchema>;
export type AuthEmailLoginRequest = z.infer<typeof authEmailLoginRequestSchema>;
export type AuthEmailPasswordRequest = z.infer<typeof authEmailPasswordRequestSchema>;
export type EmailStatusResponse = z.infer<typeof emailStatusResponseSchema>;

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

export function parseAuthRecoveryClaimRequest(
  payload: unknown,
): ParseResult<AuthRecoveryClaimRequest> {
  const parsed = authRecoveryClaimRequestSchema.safeParse(payload);
  return parsed.success ? toParseResult(parsed) : parseFailure(parsed.error);
}

export function parseAuthDeviceLinkRequest(payload: unknown): ParseResult<AuthDeviceLinkRequest> {
  const parsed = authDeviceLinkRequestSchema.safeParse(payload);
  return parsed.success ? toParseResult(parsed) : parseFailure(parsed.error);
}

export function parseAuthEmailLinkRequest(payload: unknown): ParseResult<AuthEmailLinkRequest> {
  const parsed = authEmailLinkRequestSchema.safeParse(payload);
  return parsed.success ? toParseResult(parsed) : parseFailure(parsed.error);
}

export function parseAuthEmailLoginRequest(payload: unknown): ParseResult<AuthEmailLoginRequest> {
  const parsed = authEmailLoginRequestSchema.safeParse(payload);
  return parsed.success ? toParseResult(parsed) : parseFailure(parsed.error);
}

export function parseAuthEmailPasswordRequest(
  payload: unknown,
): ParseResult<AuthEmailPasswordRequest> {
  const parsed = authEmailPasswordRequestSchema.safeParse(payload);
  return parsed.success ? toParseResult(parsed) : parseFailure(parsed.error);
}
