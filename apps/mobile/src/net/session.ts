import { browserStore, type SecretStore } from './identity.js';

/**
 * Ce qu on garde du joueur entre deux lancements.
 *
 * Volontairement maigre : un identifiant et un nom. **Aucun jeton.** Le jeton
 * d acces expire en quinze minutes et se rachete avec le secret d appareil,
 * qui est deja au chaud ; le poser en plus dans le stockage du navigateur
 * ajoute une copie a voler sans rien faire gagner.
 *
 * Ce qui est range ici ne sert qu a l affichage immediat — montrer un nom au
 * demarrage sans attendre le reseau, et savoir s il faut proposer l ecran
 * d inscription.
 */

export const SESSION_KEY = 'aura.identity';

export interface StoredIdentity {
  readonly playerId: string;
  readonly displayName: string;
}

const isIdentity = (value: unknown): value is StoredIdentity =>
  typeof value === 'object' &&
  value !== null &&
  typeof (value as StoredIdentity).playerId === 'string' &&
  typeof (value as StoredIdentity).displayName === 'string';

/**
 * L identite rangee, ou `null`.
 *
 * Une identite illisible vaut une identite absente : migration, ecriture
 * partielle, bidouille manuelle — dans tous les cas la bonne reponse est de
 * redemander au serveur, pas de refuser de demarrer.
 */
export function loadIdentity(store: SecretStore = browserStore()): StoredIdentity | null {
  let raw: string | null;
  try {
    raw = store.read(SESSION_KEY);
  } catch {
    return null;
  }
  if (raw === null) return null;

  try {
    const parsed: unknown = JSON.parse(raw);
    return isIdentity(parsed)
      ? { playerId: parsed.playerId, displayName: parsed.displayName }
      : null;
  } catch {
    return null;
  }
}

export function saveIdentity(identity: StoredIdentity, store: SecretStore = browserStore()): void {
  try {
    // Les champs sont recopies un a un : un objet de session complet passe ici
    // par megarde y deposerait ses jetons.
    store.write(
      SESSION_KEY,
      JSON.stringify({ playerId: identity.playerId, displayName: identity.displayName }),
    );
  } catch {
    // Navigation privee, quota plein : on jouera sans memoire, pas moins.
  }
}
