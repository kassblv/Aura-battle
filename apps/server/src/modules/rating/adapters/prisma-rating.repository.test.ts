import { League as LeagueColumn } from '@prisma/client';
import { describe, expect, it } from 'vitest';
import type { PinoLoggerService } from '../../../shared/logger.js';
import type { PrismaService } from '../../../shared/prisma.service.js';
import { STARTING_RATING } from '../domain/rating.js';
import { PrismaRatingRepository } from './prisma-rating.repository.js';

/**
 * Ce que l'adaptateur demande a Prisma, et comment il traduit sa reponse
 * (docs/04). Meme esprit que `prisma-rating.reader.test.ts` : un double en
 * memoire, pas de base reelle.
 */

interface RatingRow {
  playerId: string;
  seasonId: string;
  mmr: number;
  rd: number;
  leaguePoints: number;
  league: LeagueColumn;
  placements: number;
  wins: number;
  losses: number;
}

class FakePrisma {
  currentSeason: { id: string } | null = { id: 's_1' };
  rows: RatingRow[] = [];
  lastRatingWhere: unknown = null;
  upserts: { where: unknown; create: unknown; update: unknown }[] = [];
  failTransaction = false;

  readonly season = {
    findFirst: (): Promise<{ id: string } | null> => Promise.resolve(this.currentSeason),
  };

  readonly rating = {
    findMany: (args: { where: unknown }): Promise<RatingRow[]> => {
      this.lastRatingWhere = args.where;
      return Promise.resolve(this.rows);
    },
    upsert: (args: {
      where: unknown;
      create: unknown;
      update: unknown;
    }): { where: unknown; create: unknown; update: unknown } => {
      this.upserts.push(args);
      return args;
    },
  };

  $transaction = (ops: unknown[]): Promise<unknown[]> => {
    if (this.failTransaction) return Promise.reject(new Error('ECONNRESET'));
    return Promise.resolve(ops);
  };

  asService(): PrismaService {
    return this as unknown as PrismaService;
  }
}

const silentLogger = {
  error: () => undefined,
  warn: () => undefined,
} as unknown as PinoLoggerService;

const NOW = Date.parse('2026-09-20T10:00:00Z');

function build(): { prisma: FakePrisma; repo: PrismaRatingRepository } {
  const prisma = new FakePrisma();
  return { prisma, repo: new PrismaRatingRepository(prisma.asService(), silentLogger) };
}

describe('PrismaRatingRepository — loadForMatch', () => {
  it('rend null hors saison', async () => {
    const { prisma, repo } = build();
    prisma.currentSeason = null;

    expect(await repo.loadForMatch(['p1'], NOW)).toBeNull();
  });

  it('traduit chaque ligne, ligue comprise', async () => {
    const { prisma, repo } = build();
    prisma.rows = [
      {
        playerId: 'p1',
        seasonId: 's_1',
        mmr: 1_240,
        rd: 300,
        leaguePoints: 120,
        league: LeagueColumn.NAISSANTE,
        placements: 5,
        wins: 8,
        losses: 3,
      },
    ];

    const found = await repo.loadForMatch(['p1', 'p2'], NOW);

    expect(found?.seasonId).toBe('s_1');
    expect(found?.ratings.get('p1')).toEqual({
      mmr: 1_240,
      rd: 300,
      leaguePoints: 120,
      league: 'naissante',
      placements: 5,
      wins: 8,
      losses: 3,
    });
    expect(found?.ratings.has('p2')).toBe(false);
  });

  it('rend une carte vide sans interroger la base pour une liste vide', async () => {
    const { prisma, repo } = build();

    const found = await repo.loadForMatch([], NOW);

    expect(found).toEqual({ seasonId: 's_1', ratings: new Map() });
    expect(prisma.lastRatingWhere).toBeNull();
  });
});

describe('PrismaRatingRepository — leaguesOf', () => {
  it('rend la ligue de chaque joueur trouve', async () => {
    const { prisma, repo } = build();
    prisma.rows = [
      {
        playerId: 'p1',
        seasonId: 's_1',
        mmr: 1_000,
        rd: 350,
        leaguePoints: 2_600,
        league: LeagueColumn.LEGENDAIRE,
        placements: 5,
        wins: 1,
        losses: 1,
      },
    ];

    const found = await repo.leaguesOf(['p1'], NOW);

    expect(found.get('p1')).toBe('legendaire');
  });

  it('rend une carte vide hors saison', async () => {
    const { prisma, repo } = build();
    prisma.currentSeason = null;

    expect((await repo.leaguesOf(['p1'], NOW)).size).toBe(0);
  });
});

describe('PrismaRatingRepository — saveMany', () => {
  it('ecrit chaque joueur dans la meme transaction', async () => {
    const { prisma, repo } = build();

    await repo.saveMany('s_1', [
      { playerId: 'p1', rating: { ...STARTING_RATING, mmr: 1_020 } },
      { playerId: 'p2', rating: { ...STARTING_RATING, mmr: 980 } },
    ]);

    expect(prisma.upserts).toHaveLength(2);
    expect(prisma.upserts[0]?.where).toEqual({
      playerId_seasonId: { playerId: 'p1', seasonId: 's_1' },
    });
  });

  it('ne touche pas la base pour une liste vide', async () => {
    const { prisma, repo } = build();

    await repo.saveMany('s_1', []);

    expect(prisma.upserts).toHaveLength(0);
  });

  /** L'appelant decide seul de ce qu'un classement non ecrit doit faire de la suite. */
  it('laisse remonter une transaction en echec', async () => {
    const { prisma, repo } = build();
    prisma.failTransaction = true;

    await expect(
      repo.saveMany('s_1', [{ playerId: 'p1', rating: STARTING_RATING }]),
    ).rejects.toThrow();
  });
});
