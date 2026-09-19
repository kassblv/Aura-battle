import { DISPLAY_NAME_MAX, DISPLAY_NAME_MIN, displayNameSchema } from '@aura/protocol';

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
