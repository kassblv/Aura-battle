import { createHash, randomInt } from 'node:crypto';

/**
 * Le code de recuperation : garder son compte quand on change de navigateur.
 *
 * Un compte invite vit dans le stockage du navigateur. Sur ordinateur, ce
 * stockage se vide pour un rien — un nettoyage, une navigation privee, un
 * autre navigateur — et le joueur perd son classement sans avoir rien fait.
 * Le code est une **deuxieme facon de prouver qu'on est ce joueur** : une
 * ligne `AuthIdentity` de plus, exactement ce que `docs/04-data-model.md`
 * decrit pour Apple et Google.
 *
 * Ce n'est pas un mot de passe choisi par un humain : c'est un secret tire au
 * sort, que le serveur delivre et que le joueur range. Il n'y a donc ni
 * adresse e-mail a heberger, ni « mot de passe oublie », ni donnee personnelle.
 */

/**
 * Alphabet de Crockford, sans `I`, `L`, `O` ni `U`.
 *
 * Un code se lit a voix haute, se recopie d'un ecran a l'autre, parfois depuis
 * une photo. Les trois premieres lettres se confondent avec `1` et `0` ; la
 * derniere fabrique des mots qu'on ne veut pas afficher a un joueur.
 */
export const RECOVERY_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

/**
 * Seize symboles, soit **quatre-vingts bits**.
 *
 * Le secret d'appareil fait 256 bits, et c'est pour ca que `credentials.ts`
 * le hache sans sel : aucun dictionnaire ne peut exister pour cet espace de
 * recherche. Un code lisible par un humain ne peut pas faire 256 bits — mais
 * recopier ce raisonnement sur un code de soixante bits mettrait la base a
 * portee d'une attaque hors ligne realiste le jour ou elle fuiterait.
 * Quatre-vingts bits ne le sont pas, et seize symboles restent recopiables.
 */
export const RECOVERY_CODE_LENGTH = 16;

/** Habillage, jamais une donnee : il ne compte pas dans les seize symboles. */
export const RECOVERY_PREFIX = 'AURA';

/** Ce qu'on lit a la place de ce qui est ecrit (Crockford). */
const CONFUSABLE: Readonly<Record<string, string>> = Object.freeze({
  O: '0',
  I: '1',
  L: '1',
});

export function generateRecoveryCode(): string {
  let code = '';
  for (let i = 0; i < RECOVERY_CODE_LENGTH; i++) {
    // `randomInt` et non `Math.random` : c'est un secret, il lui faut la
    // meme source que le secret d'appareil.
    code += RECOVERY_ALPHABET[randomInt(0, RECOVERY_ALPHABET.length)];
  }
  return code;
}

/** La forme affichee : `AURA-XXXX-XXXX-XXXX-XXXX`. */
export function formatRecoveryCode(code: string): string {
  const groups = code.match(/.{1,4}/g) ?? [];
  return [RECOVERY_PREFIX, ...groups].join('-');
}

/**
 * Ramene une saisie a sa forme canonique, ou `null` si ce n'est pas un code.
 *
 * Genereux a dessein. Quelqu'un qui recopie un code a la main se trompe de
 * casse, ajoute des espaces, oublie un tiret, lit un `O` la ou il y a un zero.
 * Refuser pour ca, c'est perdre un joueur sur un detail de presentation alors
 * que le code est bon.
 */
export function normalizeRecoveryCode(input: string): string | null {
  const upper = input.toUpperCase();
  // On retire d'abord le prefixe d'habillage, puis tout ce qui n'est pas
  // alphanumerique : tirets, espaces, soulignes.
  const stripped = upper
    .replace(new RegExp(`^[^0-9A-Z]*${RECOVERY_PREFIX}`), '')
    .replace(/[^0-9A-Z]/g, '');

  let canonical = '';
  for (const symbol of stripped) {
    const read = CONFUSABLE[symbol] ?? symbol;
    if (!RECOVERY_ALPHABET.includes(read)) return null;
    canonical += read;
  }

  return canonical.length === RECOVERY_CODE_LENGTH ? canonical : null;
}

/**
 * Hache un code avant stockage, sur sa forme **normalisee**.
 *
 * Hacher la presentation donnerait deux haches differents pour le meme code
 * selon qu'il porte ses tirets ou non : le joueur recopierait son code
 * exactement et ne retrouverait pas son compte.
 */
export function hashRecoveryCode(input: string): string {
  const canonical = normalizeRecoveryCode(input);
  if (canonical === null) {
    // Lever plutot que rendre un hache de chaine vide : un appelant qui oublie
    // de valider doit s'en apercevoir ici, pas en cherchant pourquoi deux
    // joueurs partagent la meme identite.
    throw new Error('code de recuperation invalide');
  }
  return createHash('sha256').update(canonical).digest('hex');
}
