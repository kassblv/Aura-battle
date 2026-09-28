/**
 * Bannissement d'un joueur (ADR 0018).
 *
 * Pur : l'instant est passe en entree. `until: null` est definitif.
 */
export interface PlayerBan {
  /** Instant du bannissement, heure serveur. */
  readonly at: Date;
  /** Fin du bannissement ; `null` : definitif. */
  readonly until: Date | null;
}

/** Le bannissement court-il a cet instant ? Il cesse A son terme, pas une milliseconde apres. */
export function isBanActive(ban: PlayerBan | null | undefined, now: Date): boolean {
  if (ban === null || ban === undefined) return false;
  return ban.until === null || ban.until.getTime() > now.getTime();
}

/** Le bannissement lu des colonnes `Player.bannedAt` / `bannedUntil`. */
export function banFromColumns(bannedAt: Date | null, bannedUntil: Date | null): PlayerBan | null {
  return bannedAt === null ? null : { at: bannedAt, until: bannedUntil };
}
