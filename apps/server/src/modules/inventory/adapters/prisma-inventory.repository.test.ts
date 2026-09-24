import { describe, expect, it } from 'vitest';
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
