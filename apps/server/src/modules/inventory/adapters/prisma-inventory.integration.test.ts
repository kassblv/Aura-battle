import { randomUUID } from 'node:crypto';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';
import { afterAll, describe, expect, it } from 'vitest';
import { PurchaseConflictError } from '../domain/ports.js';
import { PrismaInventoryRepository } from './prisma-inventory.repository.js';

/**
 * Test d'integration : ce sont les CONTRAINTES de Postgres qui doivent tenir
 * les deux courses, pas un double qui les recite.
 *
 * Meme convention que `auth/adapters/prisma-repositories.integration.test.ts`
 * (chargement du `.env`, garde-fou d'hote local, saut propre si la base est
 * injoignable).
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
const reachable = prisma !== null;

const players: string[] = [];
const items: string[] = [];

afterAll(async () => {
  if (prisma !== null) {
    if (players.length > 0) await prisma.player.deleteMany({ where: { id: { in: players } } });
    if (items.length > 0) await prisma.cosmeticItem.deleteMany({ where: { id: { in: items } } });
  }
  await prisma?.$disconnect();
});

async function newPlayer(soft: number): Promise<string> {
  const player = await prisma!.player.create({
    data: { displayName: 'Testeuse', softCurrency: soft },
    select: { id: true },
  });
  players.push(player.id);
  return player.id;
}

async function newItem(priceSoft: number): Promise<string> {
  const id = `test.${randomUUID()}`;
  await prisma!.cosmeticItem.create({
    data: { id, kind: 'AURA_COLOR', rarity: 'rare', priceSoft },
  });
  items.push(id);
  return id;
}

describe.skipIf(!reachable)('PrismaInventoryRepository', () => {
  const repository = (): PrismaInventoryRepository =>
    new PrismaInventoryRepository(prisma as never);

  it('accorde l objet et debite', async () => {
    const playerId = await newPlayer(500);
    const itemId = await newItem(80);

    // La bourse rendue est celle de la base apres debit : la route repond
    // avec, sans relire l'inventaire.
    expect(await repository().grant(playerId, itemId, { soft: 80, hard: 0 })).toEqual({
      soft: 420,
      hard: 0,
    });

    const after = await repository().read(playerId);
    expect(after.wallet.soft).toBe(420);
    expect(after.owned).toContain(itemId);
  });

  it('lit le catalogue avec la rarete, une seule fois', async () => {
    const itemId = await newItem(80);
    const repo = repository();

    const catalogue = await repo.catalogue();
    expect(catalogue.find((entry) => entry.id === itemId)).toMatchObject({
      kind: 'AURA_COLOR',
      rarity: 'rare',
      priceSoft: 80,
    });
    expect(await repo.catalogue()).toBe(catalogue);
  });

  /*
    Course n°1 : le MEME objet, deux fois.

    C'est la cle primaire `(playerId, itemId)` qui tranche. Le second appel
    doit echouer — et surtout **ne pas debiter**, sinon un double-clic coute
    deux fois le prix pour un seul objet.
  */
  it('refuse le meme objet deux fois, sans debiter', async () => {
    const playerId = await newPlayer(500);
    const itemId = await newItem(80);

    await repository().grant(playerId, itemId, { soft: 80, hard: 0 });
    // La VRAIE erreur de Postgres, passee par l'adaptateur pg, doit etre
    // reconnue : un double ne prouve pas que Prisma la leve sous cette forme.
    await expect(repository().grant(playerId, itemId, { soft: 80, hard: 0 })).rejects.toMatchObject(
      { name: 'PurchaseConflictError', reason: 'ALREADY_OWNED' },
    );

    expect((await repository().read(playerId)).wallet.soft).toBe(420);
  });

  /*
    Course n°2 : deux objets DIFFERENTS, payables chacun mais pas ensemble.

    La cle primaire ne voit rien — deux objets distincts, aucun conflit. C'est
    le debit conditionnel qui tient : sans lui, la bourse passe dans le
    negatif et le joueur repart avec deux objets pour le prix d'un.
  */
  it('ne laisse pas la bourse passer sous zero', async () => {
    const playerId = await newPlayer(100);
    const [premier, second] = await Promise.all([newItem(80), newItem(80)]);

    const resultats = await Promise.allSettled([
      repository().grant(playerId, premier, { soft: 80, hard: 0 }),
      repository().grant(playerId, second, { soft: 80, hard: 0 }),
    ]);

    const reussis = resultats.filter((r) => r.status === 'fulfilled').length;
    expect(reussis).toBe(1);

    const after = await repository().read(playerId);
    expect(after.wallet.soft).toBe(20);
    expect(after.owned).toHaveLength(1);
  });

  it('refuse un achat qu on ne peut pas payer', async () => {
    const playerId = await newPlayer(10);
    const itemId = await newItem(80);

    const refused = repository().grant(playerId, itemId, { soft: 80, hard: 0 });
    await expect(refused).rejects.toBeInstanceOf(PurchaseConflictError);
    await expect(refused).rejects.toMatchObject({ reason: 'INSUFFICIENT_FUNDS' });
    expect((await repository().read(playerId)).owned).toHaveLength(0);
  });

  it('range et relit ce que le joueur porte', async () => {
    const playerId = await newPlayer(0);
    await repository().setLoadout(playerId, { auraEffect: 'fx.galaxy', auraColor: 'color.gold' });
    await repository().setLoadout(playerId, { auraEffect: 'fx.vortex' });

    expect((await repository().read(playerId)).loadout).toEqual({ auraEffect: 'fx.vortex' });
  });
});
