import { BALANCE } from '@aura/rules';
import { z } from 'zod';

/**
 * Briques communes aux messages du protocole.
 *
 * Les bornes ne sont pas recopiees a la main : elles descendent de
 * `@aura/rules`. Changer une valeur d'equilibrage resserre automatiquement la
 * validation reseau, et il devient impossible qu'elles divergent.
 */

export const seatSchema = z.enum(['a', 'b']);
export const styleSchema = z.enum(['calme', 'hype', 'provoc']);

/** Palier d'un mouvement, 0 a 4. */
export const tierSchema = z.union([
  z.literal(0),
  z.literal(1),
  z.literal(2),
  z.literal(3),
  z.literal(4),
]);

/** Niveau d'amplificateur, 0 a 4. */
export const amplifierSchema = tierSchema;

/**
 * Identifiant de match.
 *
 * Le jeu de caracteres est contraint, et ce n'est pas cosmetique : cet
 * identifiant finit concatene dans une cle Redis (`match:{id}`), dans un nom de
 * room Socket.IO et dans une ligne de journal. Autoriser `:` ou un saut de
 * ligne, c'est autoriser une collision de cle ou une fausse ligne de journal.
 */
export const matchIdSchema = z
  .string()
  .regex(/^[A-Za-z0-9_-]{1,64}$/, 'identifiant de match invalide');

/** Identifiant de contenu : toujours des segments pointes en minuscules. */
export const contentIdSchema = z
  .string()
  .regex(/^[a-z0-9]+(?:[.-][a-z0-9]+)*$/, 'identifiant de contenu invalide')
  .max(120);

/** Numero de manche, borne par le format du match. */
export const roundSchema = z.number().int().min(1).max(BALANCE.match.maxRounds);

/** Compteur d'action, croissant, pour rendre les renvois idempotents. */
export const seqSchema = z.number().int().nonnegative();

/** Instant en heure serveur (ms epoch). */
export const serverTimeSchema = z.number().int().nonnegative();

export const moveSchema = z.strictObject({
  style: styleSchema,
  tier: tierSchema,
});

export const cosmeticSchema = z.strictObject({
  animationId: contentIdSchema,
  effectId: contentIdSchema,
});

/**
 * Emplacements cosmetiques connus d'un joueur.
 *
 * Volontairement une liste fermee : c'etait le dernier conteneur ouvert du
 * registre sortant, donc le seul endroit ou un bug futur pouvait deverser le
 * profil complet de l'adversaire sans que la validation de sortie bronche.
 */
export const opponentCosmeticsSchema = z.strictObject({
  auraColor: contentIdSchema.optional(),
  auraEffect: contentIdSchema.optional(),
  outfit: contentIdSchema.optional(),
  hair: contentIdSchema.optional(),
});

export const timingQualitySchema = z.enum(['perfect', 'good', 'miss']);

/**
 * Resultat d'analyse d'un message.
 *
 * On ne renvoie pas l'objet de zod : la passerelle n'a besoin que de savoir si
 * le message est recevable et, sinon, de quoi journaliser. Garder le type de
 * zod hors de la surface publique evite aussi d'imposer sa version au serveur.
 */
export type ParseResult<T> =
  | { readonly success: true; readonly data: T }
  | {
      readonly success: false;
      readonly error: string;
      readonly issues: readonly { readonly path: string; readonly message: string }[];
    };

/**
 * Convertit une erreur zod en echec d'analyse.
 *
 * Le type de retour est `ParseResult<never>` : la branche d'echec ne porte
 * aucune donnee, donc ce resultat s'assigne a n'importe quel `ParseResult<T>`.
 * C'est ce qui permet d'analyser un registre heterogene sans transtypage.
 */
/**
 * Longueur maximale d'un message d'erreur d'analyse.
 *
 * Un message d'erreur n'est pas qu'une aide au debogage : c'est une chaine que
 * **le client remplit**. `unrecognized_keys` de zod recopie le nom de chaque
 * cle inattendue, donc un message par ailleurs valide accompagne de milliers
 * de cles inconnues produit une erreur proportionnelle a l'envoi — mesure a
 * 148 918 caracteres pour 5 000 cles, et rien n'empeche d'en envoyer plus.
 *
 * Cette chaine part dans trois journaux. En developpement, la donnee du client
 * y atterrit ; en production, le litteral gabarit qui la porte est concatene
 * **avant** que pino ne teste le niveau, donc le serveur paie l'allocation
 * sans meme ecrire de ligne.
 *
 * La borne vit ici, et pas dans chaque appelant : trois journaux aujourd'hui,
 * un quatrieme demain, et il suffirait d'en oublier un.
 */
export const MAX_PARSE_ERROR_LENGTH = 400;

/** Longueur maximale du texte d'une anomalie prise isolement. */
const MAX_ISSUE_MESSAGE_LENGTH = 120;

/** Coupe une chaine sans mentir sur le fait qu'elle est coupee. */
function clamp(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}

export function parseFailure(error: {
  readonly issues: readonly z.core.$ZodIssue[];
}): ParseResult<never> {
  const issues = error.issues.map((issue) => ({
    path: issue.path.join('.'),
    message: clamp(issue.message, MAX_ISSUE_MESSAGE_LENGTH),
  }));
  return {
    success: false,
    error: clamp(
      issues.map((issue) => `${issue.path || '(racine)'} : ${issue.message}`).join(' ; '),
      MAX_PARSE_ERROR_LENGTH,
    ),
    issues,
  };
}

export function toParseResult<T>(result: z.ZodSafeParseResult<T>): ParseResult<T> {
  return result.success ? { success: true, data: result.data } : parseFailure(result.error);
}

/** Echec d'analyse pour un evenement dont le nom n'existe pas au registre. */
export function unknownMessage<T>(name: string): ParseResult<T> {
  return {
    success: false,
    error: `Evenement inconnu : ${name}`,
    issues: [{ path: '(evenement)', message: `Evenement inconnu : ${name}` }],
  };
}
