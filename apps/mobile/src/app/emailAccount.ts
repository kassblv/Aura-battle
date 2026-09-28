import { PASSWORD_MAX, PASSWORD_MIN, emailSchema } from '@aura/protocol';

/**
 * Email et mot de passe, cote ecran : ce qu on dit au joueur.
 *
 * Les textes et les controles vivent ici, pas dans les composants : ils sont
 * partages par l accueil et les Reglages, et un test peut verifier qu ils
 * disent bien ce qu ils doivent dire. Les regles viennent du protocole — un
 * formulaire qui accepterait ce que le serveur refuse ferait attendre un
 * aller-retour pour rien.
 */

/** `link` : choisir ses identifiants. `change` : un nouveau mot de passe. `login` : les presenter. */
export type EmailFormMode = 'link' | 'change' | 'login';

export interface EmailFormFields {
  readonly email: string;
  readonly password: string;
  readonly confirm?: string;
}

/** Aucun courrier ne part jamais : le code est la seule porte de secours. */
export const FORGOT_PASSWORD_HINT = 'Mot de passe oublié ? Utilise ton code de récupération.';

/**
 * Ce qu il faut dire du formulaire, ou `null` s il n y a rien a dire.
 *
 * Un champ vide ne recoit rien : afficher une erreur avant la premiere frappe
 * met le joueur en faute pour n avoir rien fait. Chaque message dit ce qui
 * manque, pas qu il y a une erreur.
 */
export function emailFormProblem(mode: EmailFormMode, fields: EmailFormFields): string | null {
  const email = fields.email.trim();
  if (mode !== 'change' && email.length > 0 && !emailSchema.safeParse(email).success) {
    return 'Cette adresse email n’a pas l’air complète.';
  }
  if (mode === 'login' || fields.password.length === 0) return null;

  if (fields.password.length < PASSWORD_MIN) {
    return `Au moins ${String(PASSWORD_MIN)} caractères.`;
  }
  if (fields.password.length > PASSWORD_MAX) {
    return `${String(PASSWORD_MAX)} caractères au maximum.`;
  }
  if (email.length > 0 && fields.password.trim().toLowerCase() === email.toLowerCase()) {
    return 'Ton mot de passe ne doit pas être ton adresse.';
  }
  if (fields.confirm !== undefined && fields.confirm.length > 0) {
    if (fields.confirm !== fields.password) return 'Les deux mots de passe ne sont pas identiques.';
  }
  return null;
}

const FAILURES: Readonly<Record<string, string>> = Object.freeze({
  // Un seul message pour l adresse inconnue et le mauvais mot de passe : le
  // serveur ne les distingue pas, l interface non plus.
  INVALID_CREDENTIALS: 'Email ou mot de passe incorrect.',
  TOO_MANY_ATTEMPTS:
    'Trop d’essais. Réessaie dans un quart d’heure, ou utilise ton code de récupération.',
  EMAIL_UNAVAILABLE: 'Cette adresse est déjà utilisée par un autre compte.',
  EMAIL_ALREADY_LINKED: 'Ce compte a déjà une adresse email.',
  EMAIL_NOT_LINKED: 'Aucune adresse email n’est rattachée à ce compte.',
  PASSWORD_TOO_COMMON: 'Ce mot de passe est trop courant. Choisis-en un moins évident.',
  PASSWORD_MATCHES_EMAIL: 'Ton mot de passe ne doit pas être ton adresse.',
  PASSWORD_TOO_SHORT: `Au moins ${String(PASSWORD_MIN)} caractères.`,
  PASSWORD_REQUIRED: 'Entre ton mot de passe actuel pour continuer.',
  DEVICE_ALREADY_LINKED: 'Cet appareil est déjà rattaché à un autre compte. Réessaie.',
  DEVICE_PROOF_REQUIRED:
    'Cet appareil n’est plus rattaché à ton compte. Relance le jeu, ou reconnecte-toi.',
  RECOVERY_CODE_TOO_RECENT:
    'Ce code a moins d’une heure : il ne suffit pas encore. Utilise ton mot de passe actuel, ou réessaie plus tard.',
  BUSY: 'Le serveur est très sollicité. Réessaie dans un instant.',
  INVALID_EMAIL: 'Cette adresse email n’a pas l’air complète.',
  UNREACHABLE: 'Pas de réseau. Réessaie dans un instant.',
  UNAUTHORIZED: 'Ta session a expiré. Relance le jeu.',
  MALFORMED: 'Réponse inattendue du serveur.',
});

export function emailFailureMessage(reason: string): string {
  return FAILURES[reason] ?? 'Impossible pour le moment. Réessaie dans un instant.';
}
