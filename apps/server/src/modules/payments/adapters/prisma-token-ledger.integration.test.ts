import { randomUUID } from 'node:crypto';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';
import { afterAll, describe, expect, it } from 'vitest';
import { PrismaTokenLedger } from './prisma-token-ledger.js';

/**
 * Ce que Postgres accepte : les deux anti-rejeux tiennent a des contraintes
 * d'unicite, et seul Postgres peut les demontrer. Se saute si la base n'est
 * pas joignable, et ne vise jamais un hote distant.
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

const credit = (playerId: string, over: { eventId?: string; transactionId?: string } = {}) => ({
  eventId: over.eventId ?? randomUUID(),
  transactionId: over.transactionId ?? randomUUID(),
  playerId,
  productId: 'aura.tokens.100',
  tokens: 100,
  store: 'APP_STORE',
  environment: 'PRODUCTION',
});

async function withPlayer(hard: number, run: (id: string) => Promise<void>): Promise<void> {
  const player = await prisma!.player.create({
    data: { displayName: 'Acheteur', hardCurrency: hard },
  });
  try {
    await run(player.id);
  } finally {
    await prisma!.tokenPurchase.deleteMany({ where: { playerId: player.id } });
    await prisma!.player.delete({ where: { id: player.id } });
  }
}

const hardOf = async (id: string) =>
  (await prisma!.player.findUniqueOrThrow({ where: { id }, select: { hardCurrency: true } }))
    .hardCurrency;

describe.skipIf(prisma === null)('credit reel des jetons payes', () => {
  it('credite une fois, malgre un renvoi du meme evenement', async () => {
    await withPlayer(0, async (id) => {
      const ledger = new PrismaTokenLedger(prisma as never);
      const once = credit(id);
      expect(await ledger.grant(once)).toBe('granted');
      expect(await ledger.grant(once)).toBe('duplicate');
      expect(await hardOf(id)).toBe(100);
    });
  });

  // Deux evenements distincts pour UNE transaction du store : un seul credit.
  it('ne credite pas deux fois la meme transaction du store', async () => {
    await withPlayer(0, async (id) => {
      const ledger = new PrismaTokenLedger(prisma as never);
      const transactionId = randomUUID();
      expect(await ledger.grant(credit(id, { transactionId }))).toBe('granted');
      expect(await ledger.grant(credit(id, { transactionId }))).toBe('duplicate');
      expect(await hardOf(id)).toBe(100);
    });
  });

  it('inscrit pour le support un achat d un joueur inconnu, sans rien crediter', async () => {
    const ledger = new PrismaTokenLedger(prisma as never);
    const eventId = randomUUID();
    expect(await ledger.grant(credit(randomUUID(), { eventId }))).toBe('unattributed');
    const row = await prisma!.tokenPurchase.findUniqueOrThrow({ where: { eventId } });
    expect(row).toMatchObject({ status: 'UNATTRIBUTED', reason: 'UNKNOWN_PLAYER', tokens: 0 });
    await prisma!.tokenPurchase.delete({ where: { eventId } });
  });

  /*
    Remboursement : on reprend ce qui reste, jamais sous zero, et on note ce
    qui avait deja ete depense. Un renvoi du remboursement ne reprend rien.
  */
  it('reprend au remboursement ce qui reste, et note ce qui manque', async () => {
    await withPlayer(0, async (id) => {
      const ledger = new PrismaTokenLedger(prisma as never);
      const bought = credit(id);
      await ledger.grant(bought);
      await prisma!.player.update({ where: { id }, data: { hardCurrency: 30 } });

      const refund = {
        eventId: randomUUID(),
        transactionId: bought.transactionId,
        store: 'APP_STORE',
      };
      expect(await ledger.refund(refund)).toEqual({ kind: 'refunded', taken: 30, owed: 70 });
      expect(await hardOf(id)).toBe(0);
      expect(await ledger.refund(refund)).toEqual({ kind: 'already' });
      const row = await prisma!.tokenPurchase.findUniqueOrThrow({
        where: { eventId: bought.eventId },
      });
      expect(row.refundedTokens).toBe(30);
      expect(row.refundedAt).not.toBeNull();
    });
  });

  it('ignore le remboursement d une transaction inconnue', async () => {
    const ledger = new PrismaTokenLedger(prisma as never);
    expect(
      await ledger.refund({
        eventId: randomUUID(),
        transactionId: randomUUID(),
        store: 'APP_STORE',
      }),
    ).toEqual({ kind: 'unknown' });
  });
});
