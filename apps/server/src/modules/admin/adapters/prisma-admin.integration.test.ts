import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { connectLocalPrisma } from '../../../shared/test-database.js';
import { PrismaAdminAuditReader } from './prisma-admin-audit.reader.js';
import { PrismaAdminPlayerStore } from './prisma-admin-player.store.js';

/**
 * Joueurs et journal du panneau contre Postgres (ADR 0018) : recherche,
 * fiche, bannissement dans la meme transaction que son journal.
 */
const prisma = await connectLocalPrisma();
const TAG = randomUUID().slice(0, 8);
const players: string[] = [];
const matches: string[] = [];
const AT = Date.UTC(2026, 8, 26, 12);

afterAll(async () => {
  await prisma?.match.deleteMany({ where: { id: { in: matches } } });
  await prisma?.adminAction.deleteMany({ where: { target: { in: players } } });
  await prisma?.player.deleteMany({ where: { id: { in: players } } });
  await prisma?.$disconnect();
});

const create = async (displayName: string, lastSeenAtMs = AT): Promise<string> => {
  const { id } = await prisma!.player.create({
    data: {
      displayName,
      xp: 500,
      softCurrency: 12,
      hardCurrency: 4,
      lastSeenAt: new Date(lastSeenAtMs),
    },
    select: { id: true },
  });
  players.push(id);
  return id;
};

describe.skipIf(prisma === null)('PrismaAdminPlayerStore, contre Postgres', () => {
  it('cherche par nom sans casse ou par identifiant exact, borne', async () => {
    const store = new PrismaAdminPlayerStore(prisma as never);
    const a = await create(`Zorglub ${TAG} Un`, AT);
    const b = await create(`zorglub ${TAG} deux`, AT + 1_000);
    await create(`Autre ${TAG}`);

    const byName = await store.search(`ZORGLUB ${TAG}`, 20);
    // Les plus recemment vus d'abord.
    expect(byName.map((row) => row.id)).toEqual([b, a]);
    expect((await store.search(a, 20)).map((row) => row.id)).toEqual([a]);
    expect(await store.search(`ZORGLUB ${TAG}`, 1)).toHaveLength(1);
    // Un joker SQL dans la saisie ne joue pas le role de joker.
    expect(await store.search(`%${TAG}%`, 20)).toEqual([]);
  });

  it('fiche : portefeuille, matchs vus du joueur, fantome', async () => {
    const store = new PrismaAdminPlayerStore(prisma as never);
    const id = await create(`Fiche ${TAG}`);
    const other = await create(`Adversaire ${TAG}`);
    const matchId = `m_${randomUUID()}`;
    matches.push(matchId);
    await prisma!.match.create({
      data: {
        id: matchId,
        mode: 'CASUAL',
        rulesVersion: '1',
        contentVersion: '1',
        seed: 's',
        status: 'ENDED',
        endReason: 'rounds',
        winnerSeat: 'B',
        startedAt: new Date(AT - 60_000),
        seats: {
          create: [
            { seat: 'A', playerId: other },
            { seat: 'B', playerId: id },
          ],
        },
      },
    });

    const detail = await store.detail(id, AT);
    expect(detail).toMatchObject({
      id,
      xp: 500,
      softCurrency: 12,
      hardCurrency: 4,
      ban: null,
      recentMatches: [
        {
          id: matchId,
          mode: 'CASUAL',
          status: 'ENDED',
          endReason: 'rounds',
          winnerSeat: 'B',
          seat: 'B',
          isGhost: false,
        },
      ],
    });
    expect(await store.detail(`inconnu-${TAG}`, AT)).toBeNull();
  });

  it('bannit et leve dans la meme transaction que le journal', async () => {
    const store = new PrismaAdminPlayerStore(prisma as never);
    const id = await create(`Banni ${TAG}`);
    const ban = { at: new Date(AT), until: null, reason: 'compte vole' };

    expect(
      await store.setBan(id, ban, (before) => ({
        action: 'player.ban',
        target: id,
        before,
        after: { reason: ban.reason },
        reason: ban.reason,
        atMs: AT,
      })),
    ).toBe(true);
    expect((await store.detail(id, AT))?.ban).toEqual(ban);
    const row = await prisma!.player.findUniqueOrThrow({ where: { id } });
    expect(row).toMatchObject({
      bannedAt: new Date(AT),
      bannedUntil: null,
      banReason: 'compte vole',
    });

    let seenBefore: unknown = 'jamais';
    await store.setBan(id, null, (before) => {
      seenBefore = before;
      return {
        action: 'player.unban',
        target: id,
        before: null,
        after: null,
        reason: 'x',
        atMs: AT,
      };
    });
    expect(seenBefore).toEqual(ban);
    expect((await store.detail(id, AT))?.ban).toBeNull();
    expect(await prisma!.adminAction.count({ where: { target: id } })).toBe(2);

    // Journal refuse : le bannissement n'a pas lieu.
    await expect(
      store.setBan(id, ban, () => ({
        action: 'player.ban',
        target: id,
        before: null,
        after: null,
        reason: null,
        atMs: Number.NaN,
      })),
    ).rejects.toThrow();
    expect((await store.detail(id, AT))?.ban).toBeNull();

    expect(
      await store.setBan(`inconnu-${TAG}`, ban, () => ({
        action: 'player.ban',
        target: 'x',
        before: null,
        after: null,
        reason: null,
        atMs: AT,
      })),
    ).toBe(false);
  });
});

describe.skipIf(prisma === null)('PrismaAdminAuditReader, contre Postgres', () => {
  it('rend les plus recentes d abord, filtre par action et cible, borne', async () => {
    const reader = new PrismaAdminAuditReader(prisma as never);
    const target = await create(`Journal ${TAG}`);
    for (const [i, action] of ['player.ban', 'player.unban', 'player.ban'].entries()) {
      await prisma!.adminAction.create({
        data: { at: new Date(AT + i * 1_000), action, target, reason: `r${String(i)}` },
      });
    }
    const all = await reader.latest({ target }, 100);
    expect(all.map((row) => row.reason)).toEqual(['r2', 'r1', 'r0']);
    expect(
      (await reader.latest({ target, action: 'player.ban' }, 100)).map((r) => r.reason),
    ).toEqual(['r2', 'r0']);
    expect(await reader.latest({ target }, 1)).toHaveLength(1);
    expect(all[0]).toMatchObject({ action: 'player.ban', target, before: null, after: null });
  });
});
