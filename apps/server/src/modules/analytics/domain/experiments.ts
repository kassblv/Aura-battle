import type { Measure } from './indicators.js';

/**
 * Lecture des tests A/B (spec 2026-09-26 « Bulle d'intention en test A/B »).
 *
 * Les DEFINITIONS sont celles des indicateurs produit (`indicators.ts`, et
 * l'adaptateur qui les calcule), restreintes aux joueurs affectes a un groupe
 * (`FlagAssignment`). Aucun verdict ici : comparer deux groupes n'est pas
 * comparer a un seuil, et deux effectifs cote a cote disent deja si l'ecart
 * veut dire quelque chose.
 */

export type ExperimentGroup = 'treatment' | 'control';

export const EXPERIMENT_GROUPS: readonly ExperimentGroup[] = Object.freeze([
  'treatment',
  'control',
]);

/** Un groupe d'une experience : qui en fait partie. */
export interface ExperimentCohort {
  readonly flag: string;
  readonly group: ExperimentGroup;
}

/** Ce que les indicateurs disent d'un groupe. */
export interface ExperimentGroupReading {
  /** Joueurs affectes au groupe avant l'instant de lecture. */
  readonly players: number;
  readonly retentionD1: Measure;
  readonly retentionD7: Measure;
  readonly matchesPerActiveDay: Measure;
  readonly abandonRate: Measure;
}

export interface ExperimentLine {
  readonly flag: string;
  /** Part exposee en vigueur sur ce noeud, en pour cent. */
  readonly rollout: number;
  readonly groups: Readonly<Record<ExperimentGroup, ExperimentGroupReading>>;
}

export interface ExperimentReport {
  /** Instant du calcul, heure serveur. */
  readonly at: string;
  readonly experiments: readonly ExperimentLine[];
}
