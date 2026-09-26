import { Inject, Injectable } from '@nestjs/common';
import type { AdminAuditEntry } from '../../../shared/admin-audit.js';
import { writeAdminAction } from '../../../shared/admin-audit.prisma.js';
import { currentSeasonId } from '../../../shared/current-season.js';
import { PrismaService } from '../../../shared/prisma.service.js';
import type {
  AdminPlayerDetailRow,
  AdminPlayerRow,
  AdminPlayerStore,
  StoredBan,
} from '../domain/ports.js';

const RECENT_MATCHES = 20;

const PLAYER_FIELDS = {
  id: true,
  displayName: true,
  createdAt: true,
  lastSeenAt: true,
  bannedAt: true,
  bannedUntil: true,
  banReason: true,
} as const;

interface PlayerColumns {
  id: string;
  displayName: string;
  createdAt: Date;
  lastSeenAt: Date;
  bannedAt: Date | null;
  bannedUntil: Date | null;
  banReason: string | null;
}

const banOf = (row: {
  bannedAt: Date | null;
  bannedUntil: Date | null;
  banReason: string | null;
}): StoredBan | null =>
  row.bannedAt === null
    ? null
    : { at: row.bannedAt, until: row.bannedUntil, reason: row.banReason ?? '' };

const toRow = (row: PlayerColumns): AdminPlayerRow => ({
  id: row.id,
  displayName: row.displayName,
  createdAt: row.createdAt,
  lastSeenAt: row.lastSeenAt,
  ban: banOf(row),
});

/** `%`, `_` et `\` pris a la lettre dans un `ILIKE` : une saisie n'est pas un motif. */
const likeLiteral = (value: string): string => value.replace(/[\\%_]/g, (char) => `\\${char}`);

/**
 * Adaptateur Prisma des joueurs vus du panneau (ADR 0018).
 *
 * La recherche passe par une requete brute : `ILIKE` avec la saisie echappee,
 * pour qu'un `%` tape dans le champ ne devienne pas « tous les joueurs ».
 * Toutes les valeurs sont des parametres.
 */
@Injectable()
export class PrismaAdminPlayerStore implements AdminPlayerStore {
  // Jeton explicite : esbuild n'emet pas `design:paramtypes` (voir CLAUDE.md).
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async search(q: string, limit: number): Promise<readonly AdminPlayerRow[]> {
    const pattern = `%${likeLiteral(q)}%`;
    const rows = await this.prisma.$queryRaw<PlayerColumns[]>`
      SELECT "id", "displayName", "createdAt", "lastSeenAt", "bannedAt", "bannedUntil", "banReason"
      FROM "Player"
      WHERE "id" = ${q} OR "displayName" ILIKE ${pattern}
      ORDER BY "lastSeenAt" DESC, "id" ASC
      LIMIT ${limit}::int
    `;
    return rows.map(toRow);
  }

  async detail(playerId: string, nowMs: number): Promise<AdminPlayerDetailRow | null> {
    const player = await this.prisma.player.findUnique({
      where: { id: playerId },
      select: { ...PLAYER_FIELDS, xp: true, softCurrency: true, hardCurrency: true },
    });
    if (player === null) return null;

    const [seasonId, seats] = await Promise.all([
      currentSeasonId(this.prisma, nowMs),
      this.prisma.matchSeat.findMany({
        where: { playerId },
        orderBy: { match: { startedAt: 'desc' } },
        take: RECENT_MATCHES,
        select: {
          seat: true,
          match: {
            select: {
              id: true,
              mode: true,
              status: true,
              startedAt: true,
              endReason: true,
              winnerSeat: true,
              isGhost: true,
            },
          },
        },
      }),
    ]);
    const rating =
      seasonId === null
        ? null
        : await this.prisma.rating.findUnique({
            where: { playerId_seasonId: { playerId, seasonId } },
            select: { league: true },
          });

    return {
      ...toRow(player),
      xp: player.xp,
      softCurrency: player.softCurrency,
      hardCurrency: player.hardCurrency,
      league: rating === null ? null : rating.league.toLowerCase(),
      recentMatches: seats.map(({ seat, match }) => ({
        id: match.id,
        mode: match.mode,
        status: match.status,
        startedAt: match.startedAt,
        endReason: match.endReason,
        winnerSeat: match.winnerSeat,
        seat,
        isGhost: match.isGhost,
      })),
    };
  }

  async setBan(
    playerId: string,
    ban: StoredBan | null,
    audit: (before: StoredBan | null) => AdminAuditEntry,
  ): Promise<boolean> {
    return this.prisma.$transaction(async (tx) => {
      const [row] = await tx.$queryRaw<
        { bannedAt: Date | null; bannedUntil: Date | null; banReason: string | null }[]
      >`
        SELECT "bannedAt", "bannedUntil", "banReason" FROM "Player" WHERE "id" = ${playerId} FOR UPDATE
      `;
      if (row === undefined) return false;
      await tx.player.update({
        where: { id: playerId },
        data: {
          bannedAt: ban?.at ?? null,
          bannedUntil: ban?.until ?? null,
          banReason: ban?.reason ?? null,
        },
      });
      await writeAdminAction(tx, audit(banOf(row)));
      return true;
    });
  }
}
