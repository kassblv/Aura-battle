import { randomUUID } from 'node:crypto';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';
import { afterAll, describe, expect, it } from 'vitest';
import { PrismaTokenLedger } from './prisma-token-ledger.js';

/**
 * Ce que Postgres accepte : l'idempotence tient a la cle primaire de
 * `TokenPurchase`, et seul Postgres peut la demontrer. Se saute si la base
 * n'est pas joignable, et ne vise jamais un hote distant.
 */
const databaseUrl = process.env.DATABASE_URL ?? '';
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1', 'host.docker.internal']);

async function connect(): Promise<PrismaClient | null> {
  if (databaseUrl === '') return null;
  try {
    if (!LOCAL_HOSTS.has(new URL(databaseUrl).hostname)) return null;
    const client = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl }) });
    await client.$queryRaw`select 1`;
    return client;
  } catch {
    return null;
  }
}

const prisma = await connect();

afterAll(async () => {
  await prisma?.$disconnect();
});

const credit = (playerId: string, eventId = randomUUID()) => ({
  eventId,
  playerId,
  productId: 'aura.tokens.100',
  tokens: 100,
  store: 'APP_STORE',
  environment: 'PRODUCTION',
});

describe.skipIf(prisma === null)('credit reel des jetons payes', () => {
  it('credite une fois, et un renvoi du meme evenement ne credite plus', async () => {
    const player = await prisma!.player.create({ data: { displayName: 'Acheteur' } });
    const ledger = new PrismaTokenLedger(prisma as never);
    const eventId = randomUUID();

    try {
      expect(await ledger.grant(credit(player.id, eventId))).toBe('granted');
      expect(await ledger.grant(credit(player.id, eventId))).toBe('duplicate');
      const after = await prisma!.player.findUniqueOrThrow({
        where: { id: player.id },
        select: { hardCurrency: true },
      });
      expect(after.hardCurrency).toBe(100);
    } finally {
      await prisma!.player.delete({ where: { id: player.id } });
    }
  });

  it('ne cree rien pour un joueur inconnu', async () => {
    const ledger = new PrismaTokenLedger(prisma as never);
    const eventId = randomUUID();
    expect(await ledger.grant(credit(randomUUID(), eventId))).toBe('unknown_player');
    expect(await prisma!.tokenPurchase.findUnique({ where: { eventId } })).toBeNull();
  });
});
