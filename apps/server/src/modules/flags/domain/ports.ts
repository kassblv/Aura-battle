import type { FlagGroup, FlagName } from './flags.js';

/**
 * Ports du module `flags` (architecture hexagonale, docs/02).
 */

/** Une affectation a inscrire : ce joueur, ce drapeau, ce groupe, a cet instant (heure serveur). */
export interface FlagAssignmentEntry {
  readonly playerId: string;
  readonly flag: FlagName;
  readonly group: FlagGroup;
  readonly atMs: number;
}

/**
 * Inscription des affectations, pour comparer les groupes en SQL.
 *
 * **Idempotente** : la premiere inscription fait foi, les suivantes ne
 * changent rien — pas meme la date. Le groupe ne se decide jamais ici : il se
 * recalcule du hachage, l'inscription n'en garde que la trace.
 */
export interface FlagAssignmentStore {
  record(entry: FlagAssignmentEntry): Promise<void>;
}

/** Horloge, en millisecondes depuis l'epoque. */
export interface FlagClock {
  now(): number;
}
