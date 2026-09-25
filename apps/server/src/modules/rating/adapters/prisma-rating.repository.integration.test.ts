import { randomUUID } from 'node:crypto';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';
import { afterAll, describe, expect, it } from 'vitest';
import { createLogger, PinoLoggerService } from '../../../shared/logger.js';
import { loadConfig } from '../../../shared/config.js';
import { BALANCE, xpForLevel } from '@aura/rules';
import { STARTING_RATING } from '../domain/rating.js';
import { PrismaRatingRepository } from './prisma-rating.repository.js';

/**
 * Test d'integration : ce que Postgres **accepte**, pas seulement ce qu'on lui
 * demande (voir `prisma-match.integration.test.ts` pour la meme distinction).
 *
 * Deux points n'importent que Postgres puisse les trancher : la cle composite
 * `playerId_seasonId` telle qu'ecrite dans `schema.prisma`, et l'`upsert` en
 * transaction sur deux joueurs a la fois. Un double de test ne peut demontrer
 * ni l'un ni l'autre.
 *
 * Se saute proprement si la base n'est pas joignable (voir la meme garde dans
 * `prisma-match.integration.test.ts`).
 */

try {
  process.loadEnvFile(new URL('../../../../../../.env', import.meta.url));
} catch {
  // En CI les variables viennent de l'environnement.
}

const databaseUrl = process.env.DATABASE_URL ?? '';

/** Meme garde que `prisma-match.integration.test.ts` : jamais une base distante. */
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1', 'host.docker.internal']);

function isLocalDatabase(url: string): boolean {
  try {
    return LOCAL_HOSTS.has(new URL(url).hostname);
  } catch {
    return false;
  }
}

async function connect(): Promise<PrismaClient | null> {
  if (databaseUrl === '') return null;
  if (!isLocalDatabase(databaseUrl)) {
    console.warn('[integration] DATABASE_URL ne designe pas un hote local : test ignore.');
    return null;
  }
  try {
    const client = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl }) });
    await client.$queryRaw`select 1`;
    return client;
  } catch {
    return null;
  }
}

const prisma = await connect();
const reachable = prisma !== null;

afterAll(async () => {
  await prisma?.$disconnect();
});

async function createPlayer(): Promise<string> {
  const player = await prisma!.player.create({
    data: { displayName: `Test ${randomUUID().slice(0, 8)}` },
    select: { id: true },
  });
  return player.id;
}

function buildRepository(): PrismaRatingRepository {
  const config = loadConfig({
    DATABASE_URL: databaseUrl,
    REDIS_URL: 'redis://localhost:6379',
    JWT_SECRET: 'un-secret-assez-long',
    NODE_ENV: 'test',
  });
  return new PrismaRatingRepository(prisma as never, new PinoLoggerService(createLogger(config)));
}

describe.skipIf(!reachable)('ecriture et lecture reelles du classement', () => {
  it('ne trouve aucun classement pour des joueurs qui n en ont jamais eu', async () => {
    const [playerA, playerB] = [await createPlayer(), await createPlayer()];
    const repository = buildRepository();

    try {
      const found = await repository.loadForMatch([playerA, playerB], Date.now());
      expect(found?.ratings.size).toBe(0);
    } finally {
      await prisma!.player.deleteMany({ where: { id: { in: [playerA, playerB] } } });
    }
  });

  it('ecrit deux joueurs en une transaction, et les relit exactement', async () => {
    const [playerA, playerB] = [await createPlayer(), await createPlayer()];
    const repository = buildRepository();

    try {
      const before = await repository.loadForMatch([playerA, playerB], Date.now());
      expect(before).not.toBeNull();
      const seasonId = before!.seasonId;

      const ratingA = {
        ...STARTING_RATING,
        mmr: 1_024,
        leaguePoints: 120,
        league: 'naissante' as const,
      };
      const ratingB = { ...STARTING_RATING, mmr: 976, wins: 3, losses: 1 };
      await repository.saveMany(seasonId, [
        { playerId: playerA, rating: ratingA },
        { playerId: playerB, rating: ratingB },
      ]);

      const after = await repository.loadForMatch([playerA, playerB], Date.now());
      expect(after?.ratings.get(playerA)).toEqual(ratingA);
      expect(after?.ratings.get(playerB)).toEqual(ratingB);

      // La deuxieme ecriture doit REMPLACER, pas s'additionner : c'est un
      // upsert, jamais un create qui echouerait sur la cle composite.
      const updatedA = { ...ratingA, mmr: 1_050 };
      await repository.saveMany(seasonId, [{ playerId: playerA, rating: updatedA }]);
      const reread = await repository.loadForMatch([playerA], Date.now());
      expect(reread?.ratings.get(playerA)?.mmr).toBe(1_050);
    } finally {
      await prisma!.rating.deleteMany({ where: { playerId: { in: [playerA, playerB] } } });
      await prisma!.player.deleteMany({ where: { id: { in: [playerA, playerB] } } });
    }
  });

  it('rend la ligue ecrite via leaguesOf', async () => {
    const playerA = await createPlayer();
    const repository = buildRepository();

    try {
      const before = await repository.loadForMatch([playerA], Date.now());
      await repository.saveMany(before!.seasonId, [
        {
          playerId: playerA,
          rating: { ...STARTING_RATING, leaguePoints: 2_600, league: 'legendaire' },
        },
      ]);

      const leagues = await repository.leaguesOf([playerA], Date.now());
      expect(leagues.get(playerA)).toBe('legendaire');
    } finally {
      await prisma!.rating.deleteMany({ where: { playerId: playerA } });
      await prisma!.player.delete({ where: { id: playerA } });
    }
  });

  /*
    Les jetons du niveau franchi, dans la MEME transaction que l'experience :
    un credit a moitie ecrit donnerait le niveau sans ses jetons.
  */
  it('credite les jetons d un niveau franchi avec l experience', async () => {
    const playerA = await createPlayer();
    const repository = buildRepository();
    const nearLevel2 = xpForLevel(2) - 5;

    try {
      await prisma!.player.update({ where: { id: playerA }, data: { xp: nearLevel2 } });
      await repository.credit([{ playerId: playerA, soft: 20, xp: 30 }], null);
      const after = await prisma!.player.findUniqueOrThrow({
        where: { id: playerA },
        select: { hardCurrency: true, softCurrency: true, xp: true },
      });
      expect(after.xp).toBe(nearLevel2 + 30);
      expect(after.softCurrency).toBe(20);
      expect(after.hardCurrency).toBe(BALANCE.progression.tokensPerLevel);

      // Sans palier franchi, pas de jetons.
      await repository.credit([{ playerId: playerA, soft: 8, xp: 12 }], null);
      const again = await prisma!.player.findUniqueOrThrow({
        where: { id: playerA },
        select: { hardCurrency: true },
      });
      expect(again.hardCurrency).toBe(BALANCE.progression.tokensPerLevel);
    } finally {
      await prisma!.player.delete({ where: { id: playerA } });
    }
  });

  /*
    L'XP de saison (passe de saison) : meme transaction que l'experience du
    joueur, cumulee d'un match a l'autre, et rien du tout hors saison.
  */
  it('cumule l XP de saison dans la transaction du credit', async () => {
    const [playerA, playerB] = [await createPlayer(), await createPlayer()];
    const repository = buildRepository();

    try {
      const season = await repository.loadForMatch([playerA], Date.now());
      expect(season).not.toBeNull();
      const seasonId = season!.seasonId;

      await repository.credit(
        [
          { playerId: playerB, soft: 10, xp: 12 },
          { playerId: playerA, soft: 20, xp: 30 },
        ],
        seasonId,
      );
      await repository.credit([{ playerId: playerA, soft: 20, xp: 30 }], seasonId);

      const rows = await prisma!.seasonProgress.findMany({
        where: { seasonId, playerId: { in: [playerA, playerB] } },
        select: { playerId: true, xp: true, premiumAt: true },
      });
      const byPlayer = new Map(rows.map((row) => [row.playerId, row]));
      expect(byPlayer.get(playerA)?.xp).toBe(60);
      expect(byPlayer.get(playerB)?.xp).toBe(12);
      expect(byPlayer.get(playerA)?.premiumAt).toBeNull();

      // Hors saison : l'experience du joueur monte, pas celle d'une saison.
      await repository.credit([{ playerId: playerA, soft: 0, xp: 30 }], null);
      const after = await prisma!.seasonProgress.findUniqueOrThrow({
        where: { playerId_seasonId: { playerId: playerA, seasonId } },
        select: { xp: true },
      });
      expect(after.xp).toBe(60);
    } finally {
      await prisma!.player.deleteMany({ where: { id: { in: [playerA, playerB] } } });
    }
  });

  it('n ecrit aucune ligne de saison pour un credit sans experience', async () => {
    const playerA = await createPlayer();
    const repository = buildRepository();

    try {
      const season = await repository.loadForMatch([playerA], Date.now());
      await repository.credit([{ playerId: playerA, soft: 5, xp: 0 }], season!.seasonId);
      expect(await prisma!.seasonProgress.count({ where: { playerId: playerA } })).toBe(0);
    } finally {
      await prisma!.player.delete({ where: { id: playerA } });
    }
  });
});
