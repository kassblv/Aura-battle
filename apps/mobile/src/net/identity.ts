/**
 * L identite de l appareil.
 *
 * `POST /auth/device` accepte un secret de 64 caracteres hexadecimaux. Ce
 * n est **pas** un identifiant d appareil — pas d IDFV, pas de numero de
 * serie : ces valeurs sont devinables ou lisibles par d autres applications, et
 * celle-ci vaut mot de passe. Le client la tire au premier lancement et la
 * range ; le serveur n en garde que le hache.
 *
 * Consequence directe : on ne la regenere jamais si elle existe deja. Un
 * secret regenere cree un second compte vide, et le premier — avec ses
 * cosmetiques et son classement — devient inaccessible.
 */

export const DEVICE_SECRET_KEY = 'aura.deviceSecret';

/** Le trousseau de l appareil, injecte pour rester testable. */
export interface SecretStore {
  read(key: string): string | null;
  write(key: string, value: string): void;
}

/** Source d alea, injectee pour la meme raison. */
export type RandomBytes = (length: number) => Uint8Array;

const FORMAT = /^[0-9a-f]{64}$/;

/** Un trousseau injecte peut lever comme `localStorage` : on absorbe. */
function readQuietly(store: SecretStore): string | null {
  try {
    return store.read(DEVICE_SECRET_KEY);
  } catch {
    return null;
  }
}

const toHex = (bytes: Uint8Array): string =>
  Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');

/**
 * Stockage du navigateur, quand il y en a un.
 *
 * Chaque acces est protege : en navigation privee ou avec les donnees de site
 * bloquees, `localStorage` ne renvoie pas `null`, il **leve**. Un jeu qui
 * refuse de demarrer parce qu il ne peut pas ecrire une preference est un jeu
 * casse pour rien.
 */
export function browserStore(): SecretStore {
  return {
    read(key) {
      try {
        return globalThis.localStorage?.getItem(key) ?? null;
      } catch {
        return null;
      }
    },
    write(key, value) {
      try {
        globalThis.localStorage?.setItem(key, value);
      } catch {
        // Le compte vaudra pour cette session : c est degrade, pas casse.
      }
    },
  };
}

/** Alea cryptographique du navigateur. */
export function cryptoBytes(length: number): Uint8Array {
  const bytes = new Uint8Array(length);
  globalThis.crypto.getRandomValues(bytes);
  return bytes;
}

/**
 * Le secret de cet appareil : celui qui est range, ou un nouveau.
 *
 * Un secret range mais illisible est remplace. Stockage corrompu, ecriture
 * partielle, migration ratee : le garder ferait refuser la connexion a chaque
 * lancement, pour toujours. Mieux vaut repartir que rester bloque dehors.
 */
export function deviceSecret(
  store: SecretStore = browserStore(),
  randomBytes: RandomBytes = cryptoBytes,
): string {
  const stored = readQuietly(store);
  if (stored !== null && FORMAT.test(stored)) return stored;

  const secret = toHex(randomBytes(32));
  try {
    store.write(DEVICE_SECRET_KEY, secret);
  } catch {
    // Deja absorbe par `browserStore`, mais un trousseau injecte peut lever.
  }
  return secret;
}

/**
 * Rattache un secret d appareil NEUF au compte retrouve, et ne le range
 * qu une fois le rattachement confirme.
 *
 * Presenter un code ou un email **abandonne** le compte invite de ce
 * navigateur. Son ancien secret appartient encore a ce compte-la : le
 * reutiliser se heurterait a la contrainte d unicite du serveur. D ou un neuf.
 *
 * L ordre compte. Ranger le neuf AVANT que le serveur l ait accepte faisait
 * perdre l ancien au moindre echec reseau : le rechargement suivant ouvrait
 * alors un troisieme compte, vide, et le joueur perdait jusqu a son compte
 * invite. Tant que `link` n a pas reussi, l ancien secret reste en place.
 */
export async function joinWithFreshSecret(
  link: (secret: string) => Promise<void>,
  store: SecretStore = browserStore(),
  randomBytes: RandomBytes = cryptoBytes,
): Promise<string> {
  const secret = toHex(randomBytes(32));
  await link(secret);
  try {
    store.write(DEVICE_SECRET_KEY, secret);
  } catch {
    // Meme absorption qu ailleurs : sans stockage, le secret ne vit que le
    // temps de la session, ce qui reste jouable.
  }
  return secret;
}
