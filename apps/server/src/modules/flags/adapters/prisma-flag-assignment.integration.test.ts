import { randomUUID } from 'node:crypto';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';
import { afterAll, describe, expect, it } from 'vitest';
import { PrismaFlagAssignmentStore } from './prisma-flag-assignment.store.js';

/**
 * Inscription des affectations contre Postgres : premiere inscription qui
 * fait foi, renvoi sans effet, joueur inconnu sans erreur.
 *
 * Se saute si la base n'est pas joignable ou n'est pas locale (meme garde que
 * les autres tests d'integration).
 */

try {
  process.loadEnvFile(new URL('../../../../../../.env', import.meta.url));
} catch {
  // En CI les variables viennent de l'environnement.
}

const databaseUrl = process.env.DATABASE_URL ?? '';
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

afterAll(async () => {
  await prisma?.$disconnect();
});

const AT = Date.UTC(2026, 8, 26, 12, 0, 0);

describe.skipIf(prisma === null)('PrismaFlagAssignmentStore, contre Postgres', () => {
  it('inscrit une fois, garde la premiere inscription, ignore un joueur inconnu', async () => {
    const store = new PrismaFlagAssignmentStore(prisma as never);
    const { id } = await prisma!.player.create({
      data: { displayName: `Flag ${randomUUID().slice(0, 8)}` },
      select: { id: true },
    });
    try {
      await store.record({ playerId: id, flag: 'intentBubble', group: 'treatment', atMs: AT });
      // Un renvoi, meme contradictoire, ne change rien : la premiere fait foi.
      await store.record({
        playerId: id,
        flag: 'intentBubble',
        group: 'control',
        atMs: AT + 60_000,
      });
      // Un joueur qui n'existe pas (compte supprime entre-temps) : rien, sans erreur.
      await store.record({
        playerId: `inconnu-${randomUUID()}`,
        flag: 'intentBubble',
        group: 'control',
        atMs: AT,
      });

      const rows = await prisma!.flagAssignment.findMany({ where: { playerId: id } });
      expect(rows).toEqual([
        { playerId: id, flag: 'intentBubble', group: 'treatment', assignedAt: new Date(AT) },
      ]);
    } finally {
      await prisma!.player.delete({ where: { id } });
    }
  });
});
