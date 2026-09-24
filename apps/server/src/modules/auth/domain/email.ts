import { createHash } from 'node:crypto';
import { COMMON_PASSWORDS } from './common-passwords.js';

/**
 * Email et mot de passe : retrouver son compte depuis un autre appareil.
 *
 * Une identite `EMAIL` de plus dans la table, exactement comme le code de
 * recuperation (docs/04) : lier une adresse **ajoute** une ligne, sans rien
 * deplacer. L'adresse est un identifiant — jamais verifiee, jamais ecrite a
 * personne, puisque le serveur n'envoie aucun courrier. Un mot de passe oublie
 * se rattrape donc par le code de recuperation, pas par un lien.
 *
 * Ce module est pur : ni base, ni hachage lent. Le hachage argon2id est un
 * port (`PasswordHasher`), parce qu'il coute des dizaines de millisecondes et
 * que les tests du cas d'usage n'ont aucune raison de les payer.
 */

/**
 * La forme canonique d'une adresse : rognee, en minuscules.
 *
 * Meme transformation que `emailSchema` de `@aura/protocol` — un test le
 * verifie. Minuscules sur toute l'adresse, partie locale comprise : la RFC la
 * dit sensible a la casse, aucun fournisseur grand public ne l'est, et un
 * joueur qui retrouverait son compte selon la facon dont son clavier a pose
 * la majuscule ne le retrouverait pas.
 */
export function normalizeEmail(input: string): string {
  return input.trim().toLowerCase();
}

/**
 * La forme affichable dans les Reglages : `k•••@gmail.com`.
 *
 * Toujours trois points, quelle que soit la longueur : le masque ne doit pas
 * dire combien de lettres il cache. Assez pour que le joueur reconnaisse son
 * adresse, pas assez pour qu'une capture d'ecran la publie.
 */
export function maskEmail(email: string): string {
  const at = email.lastIndexOf('@');
  const local = at > 0 ? email.slice(0, at) : email;
  const domain = at > 0 ? email.slice(at) : '';
  // `Array.from` et non `local[0]` : une adresse internationalisee peut
  // commencer par un caractere hors du plan de base, qu'un indice couperait
  // en deux.
  const first = Array.from(local)[0] ?? '';
  return `${first}•••${domain}`;
}

/**
 * Prepare un mot de passe avant hachage ou comparaison.
 *
 * NFKC (NIST SP 800-63B, § 5.1.1.2) : un « é » tape sur iOS et le meme « é »
 * tape sur un clavier de PC ne sont pas toujours la meme suite d'octets. Sans
 * normalisation, un joueur choisirait son mot de passe sur son telephone et ne
 * pourrait plus l'entrer sur son ordinateur.
 */
export function preparePassword(password: string): string {
  return password.normalize('NFKC');
}

export type PasswordProblem = 'TOO_COMMON' | 'MATCHES_EMAIL';

const COMMON = new Set(COMMON_PASSWORDS);

/**
 * La regle metier du mot de passe, ou `null` s'il passe.
 *
 * Les longueurs sont au protocole (8 a 128) ; ici, ce qu'un schema ne peut pas
 * savoir. Pas de regle de composition (« une majuscule, un chiffre ») : elles
 * produisent `Password1!` et n'arretent personne. Ce qui arrete une attaque,
 * c'est de refuser les mots de passe qu'elle essaie en premier.
 */
export function passwordProblem(password: string, email: string): PasswordProblem | null {
  const candidate = preparePassword(password).toLowerCase();
  const address = normalizeEmail(email);
  const local = address.slice(0, Math.max(0, address.lastIndexOf('@')));

  // L'adresse est ce qu'un attaquant connait deja : c'est son premier essai.
  if (candidate === address || (local.length > 0 && candidate === local)) {
    return 'MATCHES_EMAIL';
  }
  if (COMMON.has(candidate)) return 'TOO_COMMON';
  return null;
}

/**
 * Cle du compteur de tentatives pour une adresse.
 *
 * Une empreinte, jamais l'adresse : ce compteur vit dans Redis, qui n'est pas
 * la base des joueurs et n'a pas a en devenir une copie. SHA-256 sans sel
 * suffit — il ne s'agit pas de cacher l'adresse a qui lit Redis (il pourrait
 * hacher des adresses candidates), mais de ne pas en poser une liste en clair
 * dans un second stockage.
 */
export function emailAttemptKey(email: string): string {
  return `email:${createHash('sha256').update(normalizeEmail(email)).digest('hex')}`;
}
