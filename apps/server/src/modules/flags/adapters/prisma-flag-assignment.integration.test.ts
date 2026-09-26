import { randomUUID } from 'node:crypto';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';
import { afterAll, describe, expect, it } from 'vitest';
import { PrismaFlagAssignmentStore } from './prisma-flag-assignment.store.js';
import { PrismaFlagSettingsStore } from './prisma-flag-settings.store.js';

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
      await store.record({
        playerId: id,
        flag: 'intentBubble',
        group: 'treatment',
        epoch: 1,
        atMs: AT,
      });
      // Un renvoi, meme contradictoire, ne change rien : la premiere fait foi.
      await store.record({
        playerId: id,
        flag: 'intentBubble',
        group: 'control',
        epoch: 1,
        atMs: AT + 60_000,
      });
      // Un joueur qui n'existe pas (compte supprime entre-temps) : rien, sans erreur.
      await store.record({
        playerId: `inconnu-${randomUUID()}`,
        flag: 'intentBubble',
        group: 'control',
        epoch: 1,
        atMs: AT,
      });
      // Une nouvelle mesure : une seconde ligne, la premiere ne bouge pas.
      await store.record({
        playerId: id,
        flag: 'intentBubble',
        group: 'control',
        epoch: 2,
        atMs: AT + 120_000,
      });

      const rows = await prisma!.flagAssignment.findMany({
        where: { playerId: id },
        orderBy: { epoch: 'asc' },
      });
      expect(rows).toEqual([
        {
          playerId: id,
          flag: 'intentBubble',
          epoch: 1,
          group: 'treatment',
          assignedAt: new Date(AT),
        },
        {
          playerId: id,
          flag: 'intentBubble',
          epoch: 2,
          group: 'control',
          assignedAt: new Date(AT + 120_000),
        },
      ]);
    } finally {
      await prisma!.player.delete({ where: { id } });
    }
  });
});

describe.skipIf(prisma === null)('PrismaFlagSettingsStore, contre Postgres', () => {
  /*
    Un nom de drapeau propre au test : la table est partagee avec le serveur de
    developpement, et le vrai `intentBubble` y vit sa vie.
  */
  const flag = `testFlag${randomUUID().slice(0, 8)}` as never;
  const initial = {
    flag,
    rollout: 30,
    measureRollout: 30,
    epoch: 1,
    measureStartedAtMs: AT,
  };

  afterAll(async () => {
    await prisma?.flagSetting.deleteMany({ where: { flag } });
    await prisma?.adminAction.deleteMany({ where: { target: flag } });
  });

  it('initialise une fois, ne remplace jamais, et journalise dans la meme transaction', async () => {
    const store = new PrismaFlagSettingsStore(prisma as never);
    const first = await store.loadAll([initial]);
    expect(first.find((state) => state.flag === flag)).toEqual(initial);

    // Une seconde initialisation avec une autre part ne change rien.
    const again = await store.loadAll([{ ...initial, rollout: 90, measureRollout: 90 }]);
    expect(again.find((state) => state.flag === flag)?.rollout).toBe(30);

    const after = await store.transition(
      flag,
      (current) => ({ ...current, epoch: current.epoch + 1, rollout: 10, measureRollout: 10 }),
      (before, next) => ({
        action: 'flag.new-measure',
        target: flag,
        before: { epoch: before.epoch },
        after: { epoch: next.epoch },
        reason: 'test',
        atMs: AT + 1_000,
      }),
    );
    expect(after).toMatchObject({ epoch: 2, rollout: 10 });
    const reread = await store.loadAll([]);
    expect(reread.find((state) => state.flag === flag)).toMatchObject({ epoch: 2, rollout: 10 });

    const audits = await prisma!.adminAction.findMany({ where: { target: flag } });
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({
      action: 'flag.new-measure',
      before: { epoch: 1 },
      after: { epoch: 2 },
      reason: 'test',
      at: new Date(AT + 1_000),
    });
  });

  it('un journal qui echoue annule l ecriture', async () => {
    const store = new PrismaFlagSettingsStore(prisma as never);
    await expect(
      store.transition(
        flag,
        (current) => ({ ...current, rollout: 0 }),
        () => ({
          action: 'flag.pause',
          target: flag,
          before: null,
          after: null,
          reason: null,
          atMs: Number.NaN,
        }),
      ),
    ).rejects.toThrow();
    const reread = await store.loadAll([]);
    expect(reread.find((state) => state.flag === flag)?.rollout).toBe(10);
  });

  it('un drapeau sans reglage ne se change pas', async () => {
    const store = new PrismaFlagSettingsStore(prisma as never);
    await expect(
      store.transition(
        'inexistant' as never,
        (current) => current,
        () => ({ action: 'x', target: 'x', before: null, after: null, reason: null, atMs: AT }),
      ),
    ).rejects.toThrow();
  });
});
