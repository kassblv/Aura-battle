import type { AdminBanRequest, AdminPlayerDetail, AdminPlayerSummary } from '@aura/protocol';
import { levelFor } from '@aura/rules';
import type {
  AdminPlayerDetailRow,
  AdminPlayerRow,
  AdminPlayerStore,
  StoredBan,
} from '../domain/ports.js';

/** Resultats d'une recherche, au plus (contrat : 20). */
export const PLAYER_SEARCH_LIMIT = 20;

/** Longueurs du contrat : un nom plus long qu'autorise ne doit pas faire tomber la fiche. */
const DISPLAY_NAME_MAX = 40;
const LEAGUE_MAX = 40;
const END_REASON_MAX = 40;

/** Une fin de bannissement deja passee : le controleur en fait une 400. */
export class InvalidBanError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidBanError';
  }
}

/** Qui previent le module match d'un bannissement (`PlayerBanEvents`). */
export interface BanPublisher {
  publish(playerId: string): void;
}

const iso = (date: Date): string => date.toISOString();

/** Le bannissement court-il a cet instant ? Meme regle que `isBanActive` (auth). */
const activeBan = (ban: StoredBan | null, nowMs: number): StoredBan | null =>
  ban !== null && (ban.until === null || ban.until.getTime() > nowMs) ? ban : null;

/** Un bannissement tel que le journal le garde. */
const auditBan = (ban: StoredBan | null) =>
  ban === null
    ? null
    : { at: iso(ban.at), until: ban.until === null ? null : iso(ban.until), reason: ban.reason };

/**
 * Les joueurs vus du panneau (ADR 0018) : recherche, fiche, bannissement.
 *
 * Aucune route ne touche aux portefeuilles : c'est un choix, pas un oubli
 * (spec 2026-09-26, hors perimetre). Le bannissement est ecrit avec sa ligne
 * de journal dans la meme transaction, PUIS publie : le module match fait
 * perdre au banni son match en cours et ferme ses sockets.
 */
export class AdminPlayersService {
  private readonly store: AdminPlayerStore;
  private readonly clock: { now(): number };
  private readonly bans: BanPublisher;

  constructor(deps: { store: AdminPlayerStore; clock: { now(): number }; bans: BanPublisher }) {
    this.store = deps.store;
    this.clock = deps.clock;
    this.bans = deps.bans;
  }

  async search(q: string): Promise<{ players: AdminPlayerSummary[] }> {
    const nowMs = this.clock.now();
    const rows = await this.store.search(q, PLAYER_SEARCH_LIMIT);
    return {
      players: rows.slice(0, PLAYER_SEARCH_LIMIT).map((row) => this.summary(row, nowMs)),
    };
  }

  async detail(playerId: string): Promise<AdminPlayerDetail | null> {
    const nowMs = this.clock.now();
    const row = await this.store.detail(playerId, nowMs);
    return row === null ? null : this.toDetail(row, nowMs);
  }

  /** Bannit jusqu'a `until`, ou definitivement (`null`). `null` si le joueur n'existe pas. */
  async ban(playerId: string, request: AdminBanRequest): Promise<AdminPlayerDetail | null> {
    const nowMs = this.clock.now();
    const until = request.until === null ? null : new Date(request.until);
    if (until !== null && until.getTime() <= nowMs) {
      throw new InvalidBanError('la fin du bannissement est deja passee');
    }
    const ban: StoredBan = { at: new Date(nowMs), until, reason: request.reason };
    const found = await this.store.setBan(playerId, ban, (before) => ({
      action: 'player.ban',
      target: playerId,
      before: auditBan(before),
      after: auditBan(ban),
      reason: request.reason,
      atMs: nowMs,
    }));
    if (!found) return null;
    // Apres l'ecriture, jamais avant : un forfait sans bannissement inscrit
    // serait une sanction sans trace.
    this.bans.publish(playerId);
    return this.detail(playerId);
  }

  /** Leve le bannissement. `null` si le joueur n'existe pas. */
  async unban(playerId: string, request: { reason: string }): Promise<AdminPlayerDetail | null> {
    const nowMs = this.clock.now();
    const found = await this.store.setBan(playerId, null, (before) => ({
      action: 'player.unban',
      target: playerId,
      before: auditBan(before),
      after: null,
      reason: request.reason,
      atMs: nowMs,
    }));
    return found ? this.detail(playerId) : null;
  }

  private summary(row: AdminPlayerRow, nowMs: number): AdminPlayerSummary {
    return {
      id: row.id,
      displayName: row.displayName.slice(0, DISPLAY_NAME_MAX),
      createdAt: iso(row.createdAt),
      lastSeenAt: iso(row.lastSeenAt),
      banned: activeBan(row.ban, nowMs) !== null,
    };
  }

  private toDetail(row: AdminPlayerDetailRow, nowMs: number): AdminPlayerDetail {
    const ban = activeBan(row.ban, nowMs);
    return {
      id: row.id,
      displayName: row.displayName.slice(0, DISPLAY_NAME_MAX),
      createdAt: iso(row.createdAt),
      lastSeenAt: iso(row.lastSeenAt),
      // Le niveau se DEDUIT de l'experience (`levelFor`), il n'est pas stocke.
      level: levelFor(row.xp).level,
      xp: Math.max(0, row.xp),
      wallet: { soft: Math.max(0, row.softCurrency), hard: Math.max(0, row.hardCurrency) },
      league: row.league === null ? null : row.league.slice(0, LEAGUE_MAX),
      ban:
        ban === null
          ? null
          : {
              until: ban.until === null ? null : iso(ban.until),
              reason: ban.reason.slice(0, 200),
              at: iso(ban.at),
            },
      recentMatches: row.recentMatches.slice(0, 20).map((match) => ({
        id: match.id,
        mode: match.mode,
        startedAt: iso(match.startedAt),
        endReason: match.endReason === null ? null : match.endReason.slice(0, END_REASON_MAX),
        // Vu du joueur. Inacheve ou sans vainqueur : ni gagne ni perdu.
        won:
          match.status !== 'ENDED' || match.winnerSeat === null
            ? null
            : match.winnerSeat === match.seat,
        ghost: match.isGhost,
      })),
    };
  }
}
