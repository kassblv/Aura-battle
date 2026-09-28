import type { AdminAuditEntry } from '../../../shared/admin-audit.js';
import type { FlagGroup, FlagName, FlagSettingState } from './flags.js';

/**
 * Ports du module `flags` (architecture hexagonale, docs/02).
 */

/** Une affectation a inscrire : ce joueur, ce drapeau, ce groupe, a cet instant (heure serveur). */
export interface FlagAssignmentEntry {
  readonly playerId: string;
  readonly flag: FlagName;
  readonly group: FlagGroup;
  /** La mesure en cours : une nouvelle mesure repart de zero inscription. */
  readonly epoch: number;
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

/**
 * Les reglages des drapeaux en base (`FlagSetting`) : l'environnement ne donne
 * plus que la valeur de depart (spec 2026-09-26, panneau qui gere).
 */
export interface FlagSettingsStore {
  /**
   * Cree les reglages absents a partir de `initial` — jamais ne remplace un
   * reglage existant — puis rend tous les reglages.
   */
  loadAll(initial: readonly FlagSettingState[]): Promise<FlagSettingState[]>;
  /**
   * Change un reglage : verrouille la ligne, calcule le suivant a partir de
   * l'etat EN BASE (pas d'un cache qu'un autre noeud aurait devance), ecrit le
   * reglage ET la ligne du journal dans la meme transaction.
   */
  transition(
    flag: FlagName,
    next: (current: FlagSettingState) => FlagSettingState,
    audit: (before: FlagSettingState, after: FlagSettingState) => AdminAuditEntry,
  ): Promise<FlagSettingState>;
}

/** Horloge, en millisecondes depuis l'epoque. */
export interface FlagClock {
  now(): number;
}
