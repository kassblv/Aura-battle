import { createHash, randomBytes, randomInt } from 'node:crypto';

/**
 * Identite d'un joueur invite (docs/04-data-model.md).
 *
 * Un compte invite n'est pas un compte au rabais : c'est une identite `DEVICE`
 * dans la meme table qu'Apple et Google. Lier un compte plus tard **ajoute une
 * ligne**, sans rien deplacer — le joueur garde son classement, son historique
 * et ses achats. C'est l'inverse d'une migration de compte, qui est toujours
 * l'endroit ou l'on perd des donnees.
 */

/**
 * Longueur du secret d'appareil, en octets.
 *
 * Ce secret **est un mot de passe** : quiconque le connait devient ce joueur.
 * Il ne doit donc jamais etre un identifiant derive de l'appareil (IDFV, numero
 * de serie, empreinte) — ces valeurs sont devinables ou lisibles par d'autres
 * applications. Le client en tire un aleatoire au premier lancement et le range
 * dans le trousseau ; le serveur n'en garde que le hache.
 */
export const DEVICE_SECRET_BYTES = 32;

/** Un secret d'appareil valide : 64 caracteres hexadecimaux. */
export const DEVICE_SECRET_PATTERN = /^[0-9a-f]{64}$/;

/** Tire un secret d'appareil. Cote client en production ; utile aux tests ici. */
export function generateDeviceSecret(): string {
  return randomBytes(DEVICE_SECRET_BYTES).toString('hex');
}

/**
 * Hache un secret avant stockage.
 *
 * SHA-256 sans sel suffit ici, contrairement a un mot de passe choisi par un
 * humain : le secret fait 256 bits d'entropie, il n'existe aucun dictionnaire a
 * lui opposer. Le sel protegerait contre des tables precalculees, qui ne
 * peuvent pas exister pour cet espace de recherche.
 */
export function hashSecret(secret: string): string {
  return createHash('sha256').update(secret).digest('hex');
}

/** Tire un jeton de rafraichissement. */
export function generateRefreshToken(): string {
  return randomBytes(48).toString('base64url');
}

const DISPLAY_NAME_PREFIX = 'Invite';

/**
 * Nom affiche par defaut.
 *
 * Quatre chiffres suffisent : le nom n'a pas a etre unique, il n'identifie
 * personne. L'unicite d'un joueur passe par son identifiant, jamais par son nom
 * — sinon un joueur ne pourrait pas choisir librement le sien plus tard.
 */
export function generateDisplayName(): string {
  return `${DISPLAY_NAME_PREFIX} ${String(randomInt(1_000, 10_000))}`;
}
