/**
 * Les erreurs recentes du serveur, gardees en memoire.
 *
 * **Elles ne survivent pas a un redemarrage, et c'est assume** : le tableau de
 * bord affiche aussi la duree de fonctionnement, donc un compteur remis a zero
 * se lit a cote d'un « demarre il y a deux minutes ». Persister demanderait un
 * magasin de journaux, c'est-a-dire une autre piece a exploiter.
 */

/** Ce qu'on regarde : la derniere journee. Au-dela, un incident est resolu. */
export const ERROR_WINDOW_MS = 24 * 3_600_000;

/**
 * Combien d'erreurs on garde au plus.
 *
 * Une borne, parce qu'un serveur parti en boucle d'erreur en produit des
 * milliers par minute. Meme lecon que le protocole : une structure dont
 * quelqu'un d'autre choisit la taille a besoin de sa propre borne.
 */
export const ERROR_LOG_CAPACITY = 50;

/** Au-dela, un message de panne n'informe plus, il remplit. */
const MESSAGE_MAX = 300;

export interface LoggedError {
  readonly at: number;
  readonly message: string;
}

export interface ErrorWindow {
  /** Combien dans la fenetre. Jamais plus que ce qu'on garde en detail. */
  readonly total: number;
  /** Les plus recentes d'abord. */
  readonly recent: readonly LoggedError[];
}

export interface ErrorLog {
  record(message: string): void;
  since(windowMs: number): ErrorWindow;
}

export function createErrorLog(now: () => number = () => Date.now()): ErrorLog {
  let entries: LoggedError[] = [];

  return {
    record(message): void {
      entries.push({ at: now(), message: message.slice(0, MESSAGE_MAX) });
      // On jette les plus VIEILLES : une panne d'il y a six heures compte
      // moins que celle de la minute qui vient de passer.
      if (entries.length > ERROR_LOG_CAPACITY) {
        entries = entries.slice(entries.length - ERROR_LOG_CAPACITY);
      }
    },

    since(windowMs): ErrorWindow {
      const floor = now() - windowMs;
      const kept = entries.filter((entry) => entry.at >= floor);
      return { total: kept.length, recent: [...kept].reverse() };
    },
  };
}
