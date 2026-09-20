import { memeGallery } from './memes.js';
import { priceOf } from './wardrobe.js';
import type { Wallet } from './profile.js';
import type { Look } from './wardrobe.js';

/**
 * Ce que le joueur a fait, entre deux lancements.
 *
 * Sans ce rangement, equiper un meme, changer de tenue ou acheter une danse
 * s'oublie au rechargement de la page. Ce n'est pas un detail de confort : le
 * joueur croit que le jeu ne l'a pas ecoute.
 *
 * **Provisoire, et assume comme tel.** L'inventaire partira du serveur au
 * jalon M5 — un inventaire tenu par le client est un inventaire qu'on s'offre
 * soi-meme. Ce qui est range ici n'est donc pas une source de verite : c'est
 * une commodite, que le numero de version permettra de jeter sans ceremonie le
 * jour ou le serveur prendra la main. Rien de ce qui est range ici ne touche a
 * un score : la regle d'or n°3 tient, meme pour quelqu'un qui editerait ce
 * stockage a la main.
 */

export const PROGRESS_KEY = 'aura.progress';

/**
 * Change des que le FORMAT change, jamais pour le contenu.
 *
 * Un format inconnu est jete plutot que devine : deviner ce qu'une version
 * precedente contenait est exactement la ou l'on invente des possessions.
 */
const VERSION = 2;

export interface Progress {
  readonly look: Look;
  /** Identifiants possedes. Ce qui est offert n'a pas besoin d'y figurer. */
  readonly owned: readonly string[];
  readonly wallet: Wallet;
  /**
   * Derniere ligue annoncee par le serveur, en CLE.
   *
   * Optionnel a dessein : une sauvegarde d'avant le classement reste valide, et
   * un joueur qui n'a jamais fini de match classe n'a pas de ligue. Ajouter un
   * champ facultatif ne justifie pas de jeter les sauvegardes existantes.
   */
  readonly league?: string;
}

/** Le strict necessaire d'un trousseau, injecte pour rester testable. */
export interface ProgressStore {
  read(): string | null;
  write(value: string): void;
}

/** Le trousseau du navigateur, ou `null` hors navigateur. */
export function browserStore(key = PROGRESS_KEY): ProgressStore {
  return {
    read: () => globalThis.localStorage?.getItem(key) ?? null,
    write: (value) => {
      globalThis.localStorage?.setItem(key, value);
    },
  };
}

function isCount(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0;
}

function isLook(value: unknown): value is Look {
  if (typeof value !== 'object' || value === null) return false;
  const look = value as Record<string, unknown>;
  const strings = ['outfit', 'hair', 'skin', 'aura'].every(
    (field) => typeof look[field] === 'string',
  );
  if (!strings) return false;
  if (typeof look.dances !== 'object' || look.dances === null) return false;
  return Object.values(look.dances as Record<string, unknown>).every(
    (id) => typeof id === 'string',
  );
}

/** Tout ce que le catalogue sait nommer : le reste n'a pas pu etre achete. */
const knownIds = new Set<string>([...memeGallery().map((card) => card.animationId)]);

function isKnown(id: string): boolean {
  // `priceOf` rend 0 pour un identifiant inconnu comme pour un objet offert :
  // la liste des memes tranche pour les danses, le vestiaire pour le reste.
  return knownIds.has(id) || priceOf(id) > 0;
}

export function loadProgress(store: ProgressStore): Progress | null {
  let raw: string | null;
  try {
    raw = store.read();
  } catch {
    // Donnees de site bloquees : on joue sans memoire plutot que pas du tout.
    return null;
  }
  if (raw === null) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null) return null;

  const data = parsed as Record<string, unknown>;
  if (data.version !== VERSION) return null;
  if (!isLook(data.look)) return null;
  if (!Array.isArray(data.owned) || !data.owned.every((id) => typeof id === 'string')) return null;

  const wallet = data.wallet;
  if (typeof wallet !== 'object' || wallet === null) return null;
  const { soft, hard } = wallet as Record<string, unknown>;
  if (!isCount(soft) || !isCount(hard)) return null;

  return {
    look: data.look,
    ...(typeof data.league === 'string' ? { league: data.league } : {}),
    // Un cosmetique retire du catalogue s'afficherait comme equipe sans
    // exister : on l'oublie plutot que de montrer un emplacement vide.
    owned: data.owned.filter(isKnown),
    wallet: { soft, hard },
  };
}

export function saveProgress(store: ProgressStore, progress: Progress): void {
  try {
    store.write(JSON.stringify({ version: VERSION, ...progress }));
  } catch {
    // Rien a faire : le joueur jouera sans memoire, ce qui reste jouable.
  }
}
