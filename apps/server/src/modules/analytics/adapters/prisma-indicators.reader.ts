import type { ProductEventKind } from '@aura/protocol';
import { Inject, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../shared/prisma.service.js';
import type { IndicatorReadings, Measure } from '../domain/indicators.js';
import type { IndicatorsReader } from '../domain/ports.js';
import { utcTimestamp } from './sql-time.js';

/**
 * Les sept indicateurs de docs/00, calcules par agregat dans Postgres.
 *
 * Les definitions sont celles de la spec
 * `docs/superpowers/specs/2026-09-26-indicateurs-produit-design.md`, et
 * `prisma-analytics.integration.test.ts` les verifie une a une, valeur ET
 * effectif. Conventions communes :
 *
 * - **Jours UTC.** « Aujourd'hui » n'est jamais complet : les fenetres
 *   s'arretent au debut du jour en cours. « Sur 7 jours » : les sept derniers
 *   jours complets, J-7 a J-1.
 * - **Match PvP** : `RANKED`, `CASUAL` ou `INVITE`, fantomes compris — le
 *   joueur, lui, a joue ; leur part est rendue a cote (`ghostShare`).
 * - **Siege d'un joueur reel** : `playerId` non nul (un fantome n'en a pas).
 * - **Les fenetres de COHORTE et de MATCH sont bornees des deux cotes** : c'est
 *   ce qui isole les tests. Deux exceptions assumees, cote consequence : le
 *   `clip_shared` d'un match de la fenetre compte meme envoye apres elle (un
 *   partage fait a 00:05 d'un match fini a 23:58), et le premier match d'un
 *   compte de la fenetre compte meme joue aujourd'hui. Un recalcul a un instant
 *   passe peut donc differer legerement de celui fait a l'epoque.
 *
 * Chaque indicateur est une requete a part : huit lectures d'agregat, a la
 * demande d'un administrateur, jamais sur le chemin d'un joueur.
 */

const DAY_MS = 86_400_000;

const PVP = Prisma.sql`m.mode IN ('RANKED', 'CASUAL', 'INVITE')`;

/** Fins de match qui comptent comme un abandon (docs/03 : `match:end.reason`). */
const ABANDON_REASONS = ['forfeit', 'disconnect'] as const;

const CLIP_SHARED = 'clip_shared' satisfies ProductEventKind;

interface RatioRow {
  n: number;
  hits: number;
}

/** Une part, ou `null` quand il n'y a rien a diviser. */
const ratio = ({ n, hits }: RatioRow): Measure => ({ value: n === 0 ? null : hits / n, n });

@Injectable()
export class PrismaIndicatorsReader implements IndicatorsReader {
  // Jeton explicite : esbuild n'emet pas `design:paramtypes` (voir CLAUDE.md).
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async read(nowMs: number): Promise<IndicatorReadings> {
    const today = Math.floor(nowMs / DAY_MS);
    const dayStart = (offset: number): Prisma.Sql => utcTimestamp((today + offset) * DAY_MS);
    const week = { from: dayStart(-7), to: dayStart(0) };

    const [
      retentionD1,
      retentionD7,
      matchesPerActiveDay,
      medianRankedWaitMs,
      clipShareRate,
      inviteInstallShare,
      abandonRate,
      ghostShare,
    ] = await Promise.all([
      // Comptes crees de J-31 a J-2, actifs a J+1.
      this.retention(1, dayStart(-31), dayStart(-1)),
      // Comptes crees de J-37 a J-8, actifs a J+7.
      this.retention(7, dayStart(-37), dayStart(-7)),
      this.matchesPerActiveDay(week.from, week.to),
      this.medianRankedWait(week.from, week.to),
      this.clipShare(week.from, week.to),
      this.inviteInstalls(dayStart(-30), dayStart(0)),
      this.abandons(week.from, week.to),
      this.ghostShare(week.from, week.to),
    ]);

    return {
      indicators: {
        retentionD1,
        retentionD7,
        matchesPerActiveDay,
        medianRankedWaitMs,
        clipShareRate,
        inviteInstallShare,
        abandonRate,
      },
      ghostShare,
    };
  }

  /**
   * Parmi les comptes crees dans `[from, to)`, la part active `days` jours
   * apres le jour de leur creation. Actif le jour D : a occupe un siege d'un
   * match PvP commence le jour D.
   */
  private async retention(days: number, from: Prisma.Sql, to: Prisma.Sql): Promise<Measure> {
    const [row] = await this.prisma.$queryRaw<RatioRow[]>`
      SELECT count(*)::int AS n,
             count(*) FILTER (WHERE EXISTS (
               SELECT 1
               FROM "MatchSeat" s
               JOIN "Match" m ON m.id = s."matchId"
               WHERE s."playerId" = c.id
                 AND ${PVP}
                 AND m."startedAt" >= c.day + ${days}::int * interval '1 day'
                 AND m."startedAt" <  c.day + (${days}::int + 1) * interval '1 day'
             ))::int AS hits
      FROM (
        SELECT p.id, date_trunc('day', p."createdAt") AS day
        FROM "Player" p
        WHERE p."createdAt" >= ${from} AND p."createdAt" < ${to}
      ) c
    `;
    return ratio(row ?? { n: 0, hits: 0 });
  }

  /**
   * Sieges PvP occupes par un joueur reel ÷ somme des actifs quotidiens.
   * L'effectif est cette somme : le nombre de journees-joueur observees.
   */
  private async matchesPerActiveDay(from: Prisma.Sql, to: Prisma.Sql): Promise<Measure> {
    const [row] = await this.prisma.$queryRaw<{ seats: number; actorDays: number }[]>`
      SELECT count(*)::int AS seats,
             count(DISTINCT (s."playerId", date_trunc('day', m."startedAt")))::int AS "actorDays"
      FROM "MatchSeat" s
      JOIN "Match" m ON m.id = s."matchId"
      WHERE s."playerId" IS NOT NULL
        AND ${PVP}
        AND m."startedAt" >= ${from} AND m."startedAt" < ${to}
    `;
    const actorDays = row?.actorDays ?? 0;
    return { value: actorDays === 0 ? null : (row?.seats ?? 0) / actorDays, n: actorDays };
  }

  /**
   * Mediane de l'attente en file des sieges `RANKED` dont l'attente est
   * connue (ni invitation ni fantome, par construction de la colonne).
   * `percentile_cont` : sur un effectif pair, la moyenne des deux du milieu.
   */
  private async medianRankedWait(from: Prisma.Sql, to: Prisma.Sql): Promise<Measure> {
    const [row] = await this.prisma.$queryRaw<{ n: number; median: number | null }[]>`
      SELECT count(s."queueWaitMs")::int AS n,
             percentile_cont(0.5) WITHIN GROUP (ORDER BY s."queueWaitMs") AS median
      FROM "MatchSeat" s
      JOIN "Match" m ON m.id = s."matchId"
      WHERE m.mode = 'RANKED'
        AND s."queueWaitMs" IS NOT NULL
        AND m."startedAt" >= ${from} AND m."startedAt" < ${to}
    `;
    return { value: row?.median ?? null, n: row?.n ?? 0 };
  }

  /**
   * Matchs PvP termines dans la fenetre (date de FIN) dont au moins un siege
   * a signale un clip. Le serveur n'inscrit un clip que d'un joueur assis au
   * match : l'existence d'une ligne suffit.
   */
  private async clipShare(from: Prisma.Sql, to: Prisma.Sql): Promise<Measure> {
    const [row] = await this.prisma.$queryRaw<RatioRow[]>`
      SELECT count(*)::int AS n,
             count(*) FILTER (WHERE EXISTS (
               SELECT 1 FROM "ProductEvent" e
               WHERE e."matchId" = m.id AND e.kind = ${CLIP_SHARED}
             ))::int AS hits
      FROM "Match" m
      WHERE ${PVP}
        AND m.status = 'ENDED'
        AND m."endedAt" >= ${from} AND m."endedAt" < ${to}
    `;
    return ratio(row ?? { n: 0, hits: 0 });
  }

  /**
   * Parmi les comptes crees dans `[from, to)` qui ont joue en PvP, la part
   * dont le PREMIER match PvP est une invitation. A egalite d'instant,
   * l'identifiant du match tranche : le resultat ne depend pas de l'ordre
   * physique des lignes.
   */
  private async inviteInstalls(from: Prisma.Sql, to: Prisma.Sql): Promise<Measure> {
    const [row] = await this.prisma.$queryRaw<RatioRow[]>`
      SELECT count(*)::int AS n,
             count(*) FILTER (WHERE f.mode = 'INVITE')::int AS hits
      FROM (
        SELECT DISTINCT ON (s."playerId") s."playerId", m.mode
        FROM "Player" p
        JOIN "MatchSeat" s ON s."playerId" = p.id
        JOIN "Match" m ON m.id = s."matchId"
        WHERE p."createdAt" >= ${from} AND p."createdAt" < ${to}
          AND ${PVP}
        ORDER BY s."playerId", m."startedAt", m.id
      ) f
    `;
    return ratio(row ?? { n: 0, hits: 0 });
  }

  /** Matchs PvP termines dans la fenetre sur forfait ou deconnexion. */
  private async abandons(from: Prisma.Sql, to: Prisma.Sql): Promise<Measure> {
    const [row] = await this.prisma.$queryRaw<RatioRow[]>`
      SELECT count(*)::int AS n,
             count(*) FILTER (WHERE m."endReason" IN (${Prisma.join(ABANDON_REASONS)}))::int AS hits
      FROM "Match" m
      WHERE ${PVP}
        AND m.status = 'ENDED'
        AND m."endedAt" >= ${from} AND m."endedAt" < ${to}
    `;
    return ratio(row ?? { n: 0, hits: 0 });
  }

  /** Part des matchs PvP commences dans la fenetre joues contre un fantome. */
  private async ghostShare(from: Prisma.Sql, to: Prisma.Sql): Promise<Measure> {
    const [row] = await this.prisma.$queryRaw<RatioRow[]>`
      SELECT count(*)::int AS n,
             count(*) FILTER (WHERE m."isGhost")::int AS hits
      FROM "Match" m
      WHERE ${PVP}
        AND m."startedAt" >= ${from} AND m."startedAt" < ${to}
    `;
    return ratio(row ?? { n: 0, hits: 0 });
  }
}
