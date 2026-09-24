import { Prisma } from '@prisma/client';
import { describe, expect, it } from 'vitest';
import { PURCHASE_TRANSACTION } from '../../../shared/database-timeouts.js';
import { PurchaseConflictError } from '../domain/ports.js';
import { PrismaInventoryRepository } from './prisma-inventory.repository.js';

/**
 * Le catalogue en memoire.
 *
 * Il ne change qu'au seed, qui tourne AVANT le demarrage du serveur
 * (`docker/entrypoint.sh`) : le relire a chaque equipement coutait une requete
 * de plus par appel, pour une reponse toujours identique.
 */

const ROW = {
  id: 'color.gold',
  kind: 'AURA_COLOR',
  rarity: 'default',
  priceSoft: 0,
  priceHard: null,
  availableFrom: null,
  availableTo: null,
};

function repositoryWith(findMany: () => Promise<unknown[]>): {
  repository: PrismaInventoryRepository;
  calls: () => number;
} {
  let calls = 0;
  const prisma = {
    cosmeticItem: {
      findMany: () => {
        calls += 1;
        return findMany();
      },
    },
  };
  return { repository: new PrismaInventoryRepository(prisma as never), calls: () => calls };
}

describe('PrismaInventoryRepository.catalogue', () => {
  it('ne lit la base qu une fois', async () => {
    const { repository, calls } = repositoryWith(() => Promise.resolve([ROW]));

    const [first, second] = await Promise.all([repository.catalogue(), repository.catalogue()]);
    const third = await repository.catalogue();

    expect(calls()).toBe(1);
    expect(first).toEqual([ROW]);
    expect(second).toBe(first);
    expect(third).toBe(first);
  });

  /*
    Un echec ne se met pas en cache : sinon une base indisponible une seconde
    au demarrage laisserait la boutique vide jusqu'au prochain deploiement.
  */
  it('relit apres un echec', async () => {
    let fail = true;
    const { repository, calls } = repositoryWith(() =>
      fail ? Promise.reject(new Error('base indisponible')) : Promise.resolve([ROW]),
    );

    await expect(repository.catalogue()).rejects.toThrow('base indisponible');
    fail = false;
    expect(await repository.catalogue()).toEqual([ROW]);
    expect(calls()).toBe(2);
  });
});

/** Erreur Prisma authentique : c'est la vraie classe que l'adaptateur reconnait. */
function prismaError(code: string): Prisma.PrismaClientKnownRequestError {
  return new Prisma.PrismaClientKnownRequestError(`echec simule ${code}`, {
    code,
    clientVersion: '7.10.0',
  });
}

/**
 * Double de la transaction de `grant` : le debit touche `debited` lignes, puis
 * la creation de la possession echoue avec `createFails`, s'il est donne.
 */
function grantingWith(debited: number, createFails?: Error): PrismaInventoryRepository {
  const tx = {
    player: {
      updateMany: () => Promise.resolve({ count: debited }),
      findUniqueOrThrow: () => Promise.resolve({ softCurrency: 20, hardCurrency: 0 }),
    },
    inventoryItem: {
      create: () => (createFails === undefined ? Promise.resolve({}) : Promise.reject(createFails)),
    },
  };
  const prisma = { $transaction: (run: (client: typeof tx) => Promise<unknown>) => run(tx) };
  return new PrismaInventoryRepository(prisma as never);
}

/*
  Chaque refus de la base dit SA raison. Tout traduire en « deja possede »
  cachait une bourse a sec derriere un faux message, et une panne derriere un
  refus poli.
*/
describe('PrismaInventoryRepository.grant', () => {
  const spend = { soft: 80, hard: 0 };

  it('rend la bourse apres debit', async () => {
    expect(await grantingWith(1).grant('p-1', 'color.violet', spend)).toEqual({
      soft: 20,
      hard: 0,
    });
  });

  it('traduit la garde de debit en bourse insuffisante', async () => {
    const refused = grantingWith(0).grant('p-1', 'color.violet', spend);
    await expect(refused).rejects.toBeInstanceOf(PurchaseConflictError);
    await expect(refused).rejects.toMatchObject({ reason: 'INSUFFICIENT_FUNDS' });
  });

  it('traduit la violation d unicite (P2002) en objet deja possede', async () => {
    const refused = grantingWith(1, prismaError('P2002')).grant('p-1', 'color.violet', spend);
    await expect(refused).rejects.toBeInstanceOf(PurchaseConflictError);
    await expect(refused).rejects.toMatchObject({ reason: 'ALREADY_OWNED' });
  });

  it('laisse passer toute autre erreur, telle quelle', async () => {
    const foreignKey = prismaError('P2003');
    await expect(grantingWith(1, foreignKey).grant('p-1', 'color.violet', spend)).rejects.toBe(
      foreignKey,
    );

    const down = new Error('connexion perdue');
    await expect(grantingWith(1, down).grant('p-1', 'color.violet', spend)).rejects.toBe(down);
  });

  /*
    Le delai de la file d'inventaire se calcule a partir de ces bornes : elles
    doivent etre celles que la transaction recoit vraiment, pas un defaut.
  */
  it('borne la transaction par PURCHASE_TRANSACTION', async () => {
    const given: unknown[] = [];
    const tx = {
      player: {
        updateMany: () => Promise.resolve({ count: 1 }),
        findUniqueOrThrow: () => Promise.resolve({ softCurrency: 20, hardCurrency: 0 }),
      },
      inventoryItem: { create: () => Promise.resolve({}) },
    };
    const prisma = {
      $transaction: (run: (client: typeof tx) => Promise<unknown>, options: unknown) => {
        given.push(options);
        return run(tx);
      },
    };

    await new PrismaInventoryRepository(prisma as never).grant('p-1', 'color.violet', spend);
    expect(given).toEqual([PURCHASE_TRANSACTION]);
  });
});
