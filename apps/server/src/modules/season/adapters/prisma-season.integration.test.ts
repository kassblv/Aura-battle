import { randomUUID } from 'node:crypto';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { SeasonGrant } from '../domain/claim.js';
import { SeasonConflictError } from '../domain/ports.js';
import { PrismaSeasonRepository } from './prisma-season.repository.js';

/**
 * Test d'integration : ce que Postgres TRANCHE, et qu'aucun double ne peut
 * montrer — la cle primaire de `SeasonClaim` contre la double reclamation,
 * le debit conditionnel de la piste premium, et une transaction qui annule
 * tout quand l'une de ses gardes refuse.
 *
 * Se saute si la base n'est pas joignable (meme garde que
 * `prisma-rating.repository.integration.test.ts`).
 */

try {
  process.loadEnvFile(new URL('../../../../../../.env', import.meta.url));
} catch {
  // En CI les variables viennent de l'environnement.
}

const databaseUrl = process.env.DATABASE_URL ?? '';

/** Jamais une base distante. */
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1', 'host.docker.internal']);

function isLocalDatabase(url: string): boolean {
  try {
    return LOCAL_HOSTS.has(new URL(url).hostname);
  } catch {
    return false;
  }
}

async function connect(): Promise<PrismaClient | null> {
  if (databaseUrl === '' || !isLocalDatabase(databaseUrl)) return null;
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

/** Un cosmetique propre au test : la base de test n'a pas forcement de catalogue. */
const ITEM = `test.pass.${randomUUID().slice(0, 8)}`;
let seasonId = '';

beforeAll(async () => {
  if (prisma === null) return;
  await prisma.cosmeticItem.create({
    data: { id: ITEM, kind: 'AURA_COLOR', rarity: 'common', priceSoft: 80 },
  });
  const repository = new PrismaSeasonRepository(prisma as never);
  const season = await repository.current(Date.now());
  if (season === null) throw new Error('la base de test n a pas de saison en cours');
  seasonId = season.id;
});

afterAll(async () => {
  await prisma?.cosmeticItem.deleteMany({ where: { id: ITEM } });
  await prisma?.$disconnect();
});

async function createPlayer(wallet: { soft?: number; hard?: number } = {}): Promise<string> {
  const player = await prisma!.player.create({
    data: {
      displayName: `Test ${randomUUID().slice(0, 8)}`,
      softCurrency: wallet.soft ?? 0,
      hardCurrency: wallet.hard ?? 0,
    },
    select: { id: true },
  });
  return player.id;
}

const walletOf = (playerId: string) =>
  prisma!.player.findUniqueOrThrow({
    where: { id: playerId },
    select: { softCurrency: true, hardCurrency: true },
  });

const grant = (overrides: Partial<SeasonGrant>): SeasonGrant => ({
  tier: 1,
  track: 'free',
  coins: 0,
  tokens: 0,
  itemId: null,
  fallbackCoins: 0,
  ...overrides,
});

describe.skipIf(!reachable)('passe de saison reel', () => {
  it('lit un joueur sans ligne comme zero XP, rien de reclame, pas de premium', async () => {
    const playerId = await createPlayer();
    const repository = new PrismaSeasonRepository(prisma as never);
    try {
      expect(await repository.progress(playerId, seasonId)).toEqual({
        xp: 0,
        premium: false,
        claimed: [],
      });
    } finally {
      await prisma!.player.delete({ where: { id: playerId } });
    }
  });

  it('inscrit puis credite pieces, jetons et cosmetique, en une transaction', async () => {
    const playerId = await createPlayer();
    const repository = new PrismaSeasonRepository(prisma as never);
    try {
      await repository.grant(playerId, seasonId, [
        grant({ tier: 1, coins: 40 }),
        grant({ tier: 2, tokens: 5 }),
        grant({ tier: 3, itemId: ITEM, fallbackCoins: 80 }),
      ]);

      expect(await walletOf(playerId)).toEqual({ softCurrency: 40, hardCurrency: 5 });
      const item = await prisma!.inventoryItem.findUniqueOrThrow({
        where: { playerId_itemId: { playerId, itemId: ITEM } },
        select: { source: true },
      });
      expect(item.source).toBe('pass');
      expect((await repository.progress(playerId, seasonId)).claimed).toEqual([
        { tier: 1, track: 'free' },
        { tier: 2, track: 'free' },
        { tier: 3, track: 'free' },
      ]);
    } finally {
      await prisma!.player.delete({ where: { id: playerId } });
    }
  });

  it('refuse une double reclamation sans crediter une seconde fois', async () => {
    const playerId = await createPlayer();
    const repository = new PrismaSeasonRepository(prisma as never);
    try {
      await repository.grant(playerId, seasonId, [grant({ tier: 1, coins: 40 })]);
      // Un lot dont UNE reclamation est deja faite : tout le lot tombe.
      await expect(
        repository.grant(playerId, seasonId, [
          grant({ tier: 2, coins: 40 }),
          grant({ tier: 1, coins: 40 }),
        ]),
      ).rejects.toBeInstanceOf(SeasonConflictError);
      expect(await walletOf(playerId)).toEqual({ softCurrency: 40, hardCurrency: 0 });
      expect((await repository.progress(playerId, seasonId)).claimed).toEqual([
        { tier: 1, track: 'free' },
      ]);
    } finally {
      await prisma!.player.delete({ where: { id: playerId } });
    }
  });

  it('ne paie qu une fois deux reclamations simultanees du meme palier', async () => {
    const playerId = await createPlayer();
    const repository = new PrismaSeasonRepository(prisma as never);
    try {
      const results = await Promise.allSettled(
        Array.from({ length: 4 }, () =>
          repository.grant(playerId, seasonId, [grant({ tier: 7, coins: 40 })]),
        ),
      );
      expect(results.filter((r) => r.status === 'fulfilled').length).toBe(1);
      for (const result of results) {
        if (result.status === 'rejected') {
          expect(result.reason).toBeInstanceOf(SeasonConflictError);
        }
      }
      expect((await walletOf(playerId)).softCurrency).toBe(40);
    } finally {
      await prisma!.player.delete({ where: { id: playerId } });
    }
  });

  it('change en pieces un cosmetique achete entre la lecture et l ecriture', async () => {
    const playerId = await createPlayer();
    const repository = new PrismaSeasonRepository(prisma as never);
    try {
      await prisma!.inventoryItem.create({ data: { playerId, itemId: ITEM, source: 'shop' } });
      await repository.grant(playerId, seasonId, [
        grant({ tier: 10, itemId: ITEM, fallbackCoins: 80 }),
      ]);
      expect((await walletOf(playerId)).softCurrency).toBe(80);
      const item = await prisma!.inventoryItem.findUniqueOrThrow({
        where: { playerId_itemId: { playerId, itemId: ITEM } },
        select: { source: true },
      });
      // L'achat reste un achat : la ligne n'est pas reecrite.
      expect(item.source).toBe('shop');
    } finally {
      await prisma!.player.delete({ where: { id: playerId } });
    }
  });

  it('refuse la piste premium sans assez de jetons, sans rien ecrire', async () => {
    const playerId = await createPlayer({ soft: 10_000, hard: 499 });
    const repository = new PrismaSeasonRepository(prisma as never);
    try {
      await expect(repository.buyPremium(playerId, seasonId, 500)).rejects.toMatchObject({
        reason: 'INSUFFICIENT_FUNDS',
      });
      expect(await walletOf(playerId)).toEqual({ softCurrency: 10_000, hardCurrency: 499 });
      // Tout est annule, jusqu'a la ligne creee pour marquer la piste.
      expect(await prisma!.seasonProgress.count({ where: { playerId } })).toBe(0);
    } finally {
      await prisma!.player.delete({ where: { id: playerId } });
    }
  });

  it('debite exactement le prix, une seule fois, meme en rafale', async () => {
    const playerId = await createPlayer({ hard: 1_200 });
    const repository = new PrismaSeasonRepository(prisma as never);
    try {
      const results = await Promise.allSettled(
        Array.from({ length: 3 }, () => repository.buyPremium(playerId, seasonId, 500)),
      );
      expect(results.filter((r) => r.status === 'fulfilled').length).toBe(1);
      expect((await walletOf(playerId)).hardCurrency).toBe(700);
      expect((await repository.progress(playerId, seasonId)).premium).toBe(true);

      await expect(repository.buyPremium(playerId, seasonId, 500)).rejects.toMatchObject({
        reason: 'ALREADY_PREMIUM',
      });
      expect((await walletOf(playerId)).hardCurrency).toBe(700);
    } finally {
      await prisma!.player.delete({ where: { id: playerId } });
    }
  });

  it('garde l XP deja gagnee quand la piste s achete apres des matchs', async () => {
    const playerId = await createPlayer({ hard: 500 });
    const repository = new PrismaSeasonRepository(prisma as never);
    try {
      await prisma!.seasonProgress.create({ data: { playerId, seasonId, xp: 420 } });
      await repository.buyPremium(playerId, seasonId, 500);
      expect(await repository.progress(playerId, seasonId)).toMatchObject({
        xp: 420,
        premium: true,
      });
    } finally {
      await prisma!.player.delete({ where: { id: playerId } });
    }
  });

  it('refuse une piste inconnue au niveau de la base', async () => {
    const playerId = await createPlayer();
    try {
      await expect(
        prisma!.seasonClaim.create({ data: { playerId, seasonId, tier: 1, track: 'gold' } }),
      ).rejects.toThrow();
    } finally {
      await prisma!.player.delete({ where: { id: playerId } });
    }
  });
});
