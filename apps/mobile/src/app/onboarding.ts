import { DISPLAY_NAME_MAX, DISPLAY_NAME_MIN, displayNameSchema } from '@aura/protocol';
import { emailFormProblem } from './emailAccount.js';

/**
 * L accueil des nouveaux.
 *
 * On joue sans inscription : le serveur ouvre une session a partir du secret
 * d appareil et baptise l invite. Ce module repond a la seule question qui
 * reste — faut-il proposer au joueur de choisir son nom, et que lui dire quand
 * sa saisie ne passe pas.
 */

export interface StoredIdentity {
  readonly playerId: string;
  readonly displayName: string;
}

/**
 * Nom de secours attribue par le serveur.
 *
 * `Invite 4417` : le mot, un espace, des chiffres. On exige la forme complete
 * pour ne pas prendre « Invitation » ou « Inviteur » pour un nom de secours et
 * harceler un joueur qui s est deja nomme.
 */
const GUEST_NAME = /^invite\s+\d+$/i;

export function needsOnboarding(identity: StoredIdentity | null): boolean {
  if (identity === null) return true;
  return GUEST_NAME.test(identity.displayName.trim());
}

/**
 * Ce qu il faut dire au joueur sur sa saisie, ou `null` si tout va bien.
 *
 * Un champ vide ne recoit rien : afficher une erreur avant la premiere frappe
 * met le joueur en faute pour n avoir rien fait. Et chaque message dit **ce
 * qui manque**, pas qu il y a une erreur — « au moins deux caracteres » se
 * corrige, « nom invalide » ne se corrige pas.
 */
export function nameHint(input: string): string | null {
  const trimmed = input.trim();
  if (trimmed.length === 0) return null;
  if (displayNameSchema.safeParse(input).success) return null;

  // Les bornes sont citees depuis les constantes partagees, jamais epelees :
  // un message qui ecrit « seize » en toutes lettres ment le jour ou la borne
  // change, et il ment sans que rien ne le signale.
  if (trimmed.length < DISPLAY_NAME_MIN) {
    return `Au moins ${String(DISPLAY_NAME_MIN)} caractères.`;
  }
  if (trimmed.length > DISPLAY_NAME_MAX) {
    return `${String(DISPLAY_NAME_MAX)} caractères au maximum, pas ${String(trimmed.length)}.`;
  }
  if (/\s{2}/.test(trimmed)) return 'Un seul espace à la fois.';
  return 'Lettres, chiffres, espace, tiret, point ou souligné — et une lettre ou un chiffre pour commencer.';
}

/** Le formulaire de bienvenue : un nom, et des identifiants facultatifs. */
export interface WelcomeForm {
  readonly name: string;
  readonly email: string;
  readonly password: string;
  readonly confirm: string;
}

export interface WelcomeStep {
  /** Le nom a enregistrer, ou `null` pour garder le nom d invite. */
  readonly rename: string | null;
  /** Les identifiants a rattacher, ou `null` : rien a rattacher. */
  readonly credentials: { readonly email: string; readonly password: string } | null;
  /** Ce qui empeche d envoyer, dit au joueur ; `null` s il n y a rien a dire. */
  readonly problem: string | null;
  readonly ready: boolean;
}

/**
 * Ce que « C est parti » va faire du formulaire de bienvenue.
 *
 * S inscrire, ici, ce n est pas creer un compte : il existe deja, ouvert par
 * le secret d appareil. C est rattacher un email et un mot de passe a CE
 * compte, et choisir son nom. Les identifiants sont facultatifs — un jeu qui
 * retient son joueur derriere un formulaire perd celui qui voulait juste voir.
 *
 * `linked` : les identifiants sont deja rattaches, lors d un essai precedent
 * dont seul le renommage a echoue. On ne les renvoie pas.
 */
export function welcomeStep(form: WelcomeForm, linked: boolean): WelcomeStep {
  const name = form.name.trim();
  const nameProblem = nameHint(form.name);
  const rename = name.length > 0 && nameProblem === null ? name : null;

  const touched =
    !linked &&
    (form.email.trim().length > 0 || form.password.length > 0 || form.confirm.length > 0);
  const complete =
    form.email.trim().length > 0 && form.password.length > 0 && form.confirm.length > 0;
  const credentialProblem = touched ? emailFormProblem('link', form) : null;

  const problem =
    credentialProblem ??
    (touched && !complete
      ? 'Pour créer ton compte, remplis l’email et les deux mots de passe — ou laisse-les vides.'
      : null);
  const credentials =
    touched && complete && credentialProblem === null
      ? { email: form.email.trim(), password: form.password }
      : null;

  const ready =
    nameProblem === null &&
    problem === null &&
    (rename !== null || credentials !== null || (linked && name.length === 0));
  return { rename, credentials, problem, ready };
}
