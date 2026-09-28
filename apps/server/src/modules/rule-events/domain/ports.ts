import type { AdminAuditEntry } from '../../../shared/admin-audit.js';

/**
 * Ports du module `rule-events` : l'evenement de la semaine, force ou non
 * (ADR 0018). Architecture hexagonale (docs/02) : le service ne connait ni
 * Prisma ni l'horloge systeme.
 */

/** Les semaines forcees (`RuleEventOverride`). */
export interface RuleEventStore {
  /** Les forcages des semaines `>= fromWeek`, par numero de semaine. */
  loadFrom(fromWeek: number): Promise<ReadonlyMap<number, string>>;
  /**
   * Pose (`variant`) ou retire (`null`) le forcage d'une semaine, et inscrit la
   * ligne du journal dans la MEME transaction. `audit` recoit la variante
   * forcee avant l'ecriture, lue sous verrou.
   */
  setOverride(
    week: number,
    variant: string | null,
    audit: (before: string | null) => AdminAuditEntry,
  ): Promise<void>;
}

/** Heure serveur, en millisecondes. */
export interface RuleEventClock {
  now(): number;
}
