import type { Verdict } from './status.js';

/**
 * Ports du panneau d'administration.
 *
 * Chaque sonde rend `null` quand elle ne sait pas, jamais une valeur inventee :
 * un tableau de bord qui affiche un chiffre faux est pire qu'un tableau qui
 * avoue ne pas savoir — on agit sur le premier, on enquete sur le second.
 */

export interface DatabaseSnapshot {
  readonly players: number;
  readonly matchesTotal: number;
  readonly matchesLastDay: number;
  readonly rankedPlayers: number;
  readonly lastMatchAt: Date | null;
}

export interface QueueSnapshot {
  readonly waiting: number;
}

export interface AdminProbes {
  /** `null` si la base est injoignable — ce qui est en soi le verdict. */
  database(): Promise<DatabaseSnapshot | null>;
  queue(): Promise<QueueSnapshot | null>;
  /** Horodatage de la derniere sauvegarde REUSSIE, ou `null`. */
  lastBackup(): Promise<Date | null>;
}

export interface ComponentStatus {
  readonly name: string;
  readonly verdict: Verdict;
  /** Une phrase, en francais, qui dit ce qu'on sait. */
  readonly detail: string;
}
