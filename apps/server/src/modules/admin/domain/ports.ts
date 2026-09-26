import type { AdminAuditEntry } from '../../../shared/admin-audit.js';
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

/* ---------- Ecritures du panneau (ADR 0018) ---------- */

/** Un bannissement tel qu'on le stocke : instant, fin (`null` : definitif), motif. */
export interface StoredBan {
  readonly at: Date;
  readonly until: Date | null;
  readonly reason: string;
}

export interface AdminPlayerRow {
  readonly id: string;
  readonly displayName: string;
  readonly createdAt: Date;
  readonly lastSeenAt: Date;
  readonly ban: StoredBan | null;
}

export interface AdminPlayerMatchRow {
  readonly id: string;
  readonly mode: 'RANKED' | 'CASUAL' | 'INVITE' | 'SOLO';
  readonly status: 'IN_PROGRESS' | 'ENDED' | 'ABORTED';
  readonly startedAt: Date;
  readonly endReason: string | null;
  readonly winnerSeat: 'A' | 'B' | null;
  /** Le siege du joueur dans ce match. */
  readonly seat: 'A' | 'B';
  readonly isGhost: boolean;
}

export interface AdminPlayerDetailRow extends AdminPlayerRow {
  readonly xp: number;
  readonly softCurrency: number;
  readonly hardCurrency: number;
  /** Ligue de la saison en cours, `null` sans saison ou sans classement. */
  readonly league: string | null;
  /** Les vingt derniers matchs, du plus recent au plus ancien. */
  readonly recentMatches: readonly AdminPlayerMatchRow[];
}

/**
 * Lecture et bannissement des joueurs pour le panneau.
 *
 * `ban` et `unban` ecrivent le joueur ET la ligne du journal dans la meme
 * transaction, apres avoir verrouille la ligne du joueur : l'etat « avant »
 * du journal est celui qu'on remplace vraiment. Ils rendent `false` si le
 * joueur n'existe pas.
 */
export interface AdminPlayerStore {
  /** Nom contenant `q` (sans casse) ou identifiant egal a `q` ; `limit` au plus. */
  search(q: string, limit: number): Promise<readonly AdminPlayerRow[]>;
  detail(playerId: string, nowMs: number): Promise<AdminPlayerDetailRow | null>;
  setBan(
    playerId: string,
    ban: StoredBan | null,
    audit: (before: StoredBan | null) => AdminAuditEntry,
  ): Promise<boolean>;
}

export interface AdminAuditRow {
  readonly id: string;
  readonly at: Date;
  readonly action: string;
  readonly target: string;
  readonly before: unknown;
  readonly after: unknown;
  readonly reason: string | null;
}

/** Lecture du journal d'administration, du plus recent au plus ancien. */
export interface AdminAuditReader {
  latest(
    filter: { readonly action?: string; readonly target?: string },
    limit: number,
  ): Promise<readonly AdminAuditRow[]>;
}

/** Jeton d'injection du lecteur du journal : le controleur depend du port, pas de Prisma. */
export const ADMIN_AUDIT_READER = Symbol('ADMIN_AUDIT_READER');
