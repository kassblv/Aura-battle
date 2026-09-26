import type { ProductEventKind } from '@aura/protocol';
import type { ExperimentCohort, ExperimentGroupReading } from './experiments.js';
import type { IndicatorReadings } from './indicators.js';

/**
 * Ports du module `analytics` (architecture hexagonale, docs/02).
 *
 * Mesure interne, sans fournisseur : rien de ce qui passe par ces ports ne
 * quitte nos serveurs (spec des indicateurs produit, docs/10).
 */

/** Un evenement produit a inscrire, tel que le serveur l'a authentifie et date. */
export interface ProductEventEntry {
  readonly playerId: string;
  readonly matchId: string;
  readonly kind: ProductEventKind;
  /** Heure serveur de reception, jamais une heure declaree par le client. */
  readonly atMs: number;
}

export interface ProductEventStore {
  /**
   * Inscrit l'evenement **si et seulement si** le joueur a occupe un siege de
   * ce match, et au plus une fois par (joueur, match, sorte).
   *
   * Le controle et l'ecriture forment une seule operation : un controle suivi
   * d'une ecriture laisserait une fenetre, et deux renvois simultanes
   * produiraient une erreur d'unicite au lieu d'un effet nul.
   *
   * Rend `true` si une ligne a ete creee — pour les tests et le journal ;
   * jamais pour la reponse HTTP, qui ne doit rien apprendre a qui sonde.
   */
  recordIfSeated(entry: ProductEventEntry): Promise<boolean>;
}

/** Lecture des indicateurs, a un instant donne (heure serveur, jours UTC). */
export interface IndicatorsReader {
  read(nowMs: number): Promise<IndicatorReadings>;
}

/**
 * Lecture d'un groupe de test A/B, a un instant donne : les memes definitions
 * que `IndicatorsReader`, restreintes aux joueurs du groupe.
 */
export interface ExperimentsReader {
  readCohort(nowMs: number, cohort: ExperimentCohort): Promise<ExperimentGroupReading>;
}

/** Les experiences declarees, avec leur part en vigueur (module `flags`). */
export interface DeclaredExperiments {
  declared(): readonly { readonly flag: string; readonly rollout: number }[];
}

/** Horloge : le module recoit le temps, il ne le lit pas. */
export interface Clock {
  now(): Date;
}
