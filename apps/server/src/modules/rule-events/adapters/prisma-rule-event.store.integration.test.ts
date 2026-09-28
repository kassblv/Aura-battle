import { afterAll, describe, expect, it } from 'vitest';
import { connectLocalPrisma } from '../../../shared/test-database.js';
import { PrismaRuleEventStore } from './prisma-rule-event.store.js';

/**
 * Semaines forcees contre Postgres : pose, remplacement, retrait, journal dans
 * la meme transaction. Des semaines tres lointaines, propres au test : la table
 * est partagee avec le serveur de developpement.
 */
const prisma = await connectLocalPrisma();
const BASE = 900_000 + Math.floor(Math.random() * 50_000);
const AT = Date.UTC(2026, 8, 26, 12);

afterAll(async () => {
  await prisma?.ruleEventOverride.deleteMany({ where: { week: { gte: BASE, lt: BASE + 10 } } });
  await prisma?.adminAction.deleteMany({
    where: { target: { in: Array.from({ length: 10 }, (_, i) => `week:${String(BASE + i)}`) } },
  });
  await prisma?.$disconnect();
});

describe.skipIf(prisma === null)('PrismaRuleEventStore, contre Postgres', () => {
  const audit = (week: number, variant: string | null) => (before: string | null) => ({
    action: 'event.override',
    target: `week:${String(week)}`,
    before: { variant: before },
    after: { variant },
    reason: 'test',
    atMs: AT,
  });

  it('pose, remplace et retire un forcage, avec son journal', async () => {
    const store = new PrismaRuleEventStore(prisma as never);
    await store.setOverride(BASE, 'ultime', audit(BASE, 'ultime'));
    await store.setOverride(BASE + 1, 'normal', audit(BASE + 1, 'normal'));
    await store.setOverride(BASE, 'contres', audit(BASE, 'contres'));

    const loaded = await store.loadFrom(BASE);
    expect(loaded.get(BASE)).toBe('contres');
    expect(loaded.get(BASE + 1)).toBe('normal');
    expect((await store.loadFrom(BASE + 1)).has(BASE)).toBe(false);

    await store.setOverride(BASE, null, audit(BASE, null));
    expect((await store.loadFrom(BASE)).has(BASE)).toBe(false);

    const audits = await prisma!.adminAction.findMany({
      where: { target: `week:${String(BASE)}` },
      orderBy: { at: 'asc' },
    });
    expect(audits.map((row) => [row.before, row.after])).toEqual([
      [{ variant: null }, { variant: 'ultime' }],
      [{ variant: 'ultime' }, { variant: 'contres' }],
      [{ variant: 'contres' }, { variant: null }],
    ]);
  });

  it('un journal qui echoue annule le forcage', async () => {
    const store = new PrismaRuleEventStore(prisma as never);
    await expect(
      store.setOverride(BASE + 2, 'ultime', () => ({
        action: 'event.override',
        target: 'x',
        before: null,
        after: null,
        reason: null,
        atMs: Number.NaN,
      })),
    ).rejects.toThrow();
    expect((await store.loadFrom(BASE + 2)).has(BASE + 2)).toBe(false);
  });
});
