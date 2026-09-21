import { describe, expect, it } from 'vitest';
import { InventoryError, InventoryService } from './inventory.js';
import type { CatalogueEntry } from '../domain/purchase.js';
import type { InventoryRepository, PlayerInventory } from '../domain/ports.js';

const CATALOGUE: readonly CatalogueEntry[] = [
  {
    id: 'color.violet',
    kind: 'AURA_COLOR',
    priceSoft: 80,
    priceHard: null,
    availableFrom: null,
    availableTo: null,
  },
  {
    id: 'color.gold',
    kind: 'AURA_COLOR',
    priceSoft: 0,
    priceHard: null,
    availableFrom: null,
    availableTo: null,
  },
  {
    id: 'fx.galaxy',
    kind: 'AURA_EFFECT',
    priceSoft: 850,
    priceHard: null,
    availableFrom: null,
    availableTo: null,
  },
];

/** Depot en memoire, avec la meme contrainte d'unicite que la base. */
function repository(start: Partial<PlayerInventory> = {}) {
  const state: PlayerInventory = {
    wallet: { soft: 1_000, hard: 0 },
    owned: [],
    loadout: null,
    ...start,
  };
  const debits: { soft: number; hard: number }[] = [];
  /** Achats qu'on force a perdre la course, une fois chacun. */
  let collideOnce = false;

  const port: InventoryRepository = {
    catalogue: () => Promise.resolve(CATALOGUE),
    read: () => Promise.resolve(state),
    grant: (_playerId, itemId, spend) => {
      if (collideOnce) {
        collideOnce = false;
        return Promise.reject(new Error('ALREADY_GRANTED'));
      }
      if (state.owned.includes(itemId)) return Promise.reject(new Error('ALREADY_GRANTED'));
      debits.push(spend);
      (state.owned as string[]).push(itemId);
      (state as { wallet: { soft: number; hard: number } }).wallet = {
        soft: state.wallet.soft - spend.soft,
        hard: state.wallet.hard - spend.hard,
      };
      return Promise.resolve();
    },
    setLoadout: (_playerId, data) => {
      (state as { loadout: unknown }).loadout = data;
      return Promise.resolve();
    },
  };

  return {
    port,
    state,
    debits,
    collideNext: () => {
      collideOnce = true;
    },
  };
}

const service = (repo: ReturnType<typeof repository>) =>
  new InventoryService({ inventory: repo.port, clock: { now: () => new Date('2026-09-21') } });

describe('buy', () => {
  it('accorde l objet et debite une fois', async () => {
    const repo = repository();
    await service(repo).buy('p-1', 'color.violet');

    expect(repo.state.owned).toContain('color.violet');
    expect(repo.debits).toEqual([{ soft: 80, hard: 0 }]);
    expect(repo.state.wallet.soft).toBe(920);
  });

  it('refuse un objet absent du catalogue', async () => {
    const repo = repository();
    await expect(service(repo).buy('p-1', 'color.inexistante')).rejects.toMatchObject({
      reason: 'UNKNOWN_ITEM',
    });
  });

  it('remonte le refus du domaine', async () => {
    const repo = repository({ wallet: { soft: 10, hard: 0 } });
    await expect(service(repo).buy('p-1', 'fx.galaxy')).rejects.toMatchObject({
      reason: 'INSUFFICIENT_FUNDS',
    });
    expect(repo.debits).toHaveLength(0);
  });

  /*
    LE cas qui compte : deux onglets, un seul objet.

    La regle est pure et lit un etat ; entre sa lecture et l'ecriture, un autre
    appel peut avoir accorde le meme objet. C'est la base qui tranche, par sa
    cle primaire `(playerId, itemId)` — et le perdant doit repartir avec
    « tu le possedes deja », pas avec une erreur serveur, et SURTOUT pas avec
    un second debit.
  */
  it('ne debite qu une fois quand deux achats se croisent', async () => {
    const repo = repository();
    repo.collideNext();

    await expect(service(repo).buy('p-1', 'color.violet')).rejects.toMatchObject({
      reason: 'ALREADY_OWNED',
    });
    expect(repo.debits).toHaveLength(0);
    expect(repo.state.wallet.soft).toBe(1_000);
  });

  it('refuse un second achat du meme objet', async () => {
    const repo = repository();
    await service(repo).buy('p-1', 'color.violet');
    await expect(service(repo).buy('p-1', 'color.violet')).rejects.toMatchObject({
      reason: 'ALREADY_OWNED',
    });
    expect(repo.debits).toHaveLength(1);
  });
});

describe('read', () => {
  /*
    Tout ce qui est a zero appartient a tout le monde.

    Les accorder un par un a l'achat demanderait au joueur de « payer » zero
    pour chaque couleur offerte, et remplirait la table d'autant de lignes
    inutiles. Ils sont donc ajoutes a la lecture, sans jamais etre ecrits.
  */
  it('ajoute les objets gratuits a ce qu on possede', async () => {
    const repo = repository();
    const inventory = await service(repo).read('p-1');

    expect(inventory.owned).toContain('color.gold');
    expect(inventory.owned).not.toContain('color.violet');
    // Rien n'est ecrit pour autant : la base ne porte que les vrais achats.
    expect(repo.state.owned).toEqual([]);
  });

  it('n ajoute pas deux fois un gratuit deja possede', async () => {
    const repo = repository({ owned: ['color.gold'] });
    const inventory = await service(repo).read('p-1');
    expect(inventory.owned.filter((id) => id === 'color.gold')).toHaveLength(1);
  });
});

describe('equip', () => {
  it('enregistre un equipement de ce qu on possede', async () => {
    const repo = repository({ owned: ['fx.galaxy'] });
    await service(repo).equip('p-1', { auraEffect: 'fx.galaxy' });
    expect(repo.state.loadout).toEqual({ auraEffect: 'fx.galaxy' });
  });

  /*
    On ne peut pas porter ce qu'on n'a pas. Sans cette garde, l'ecran de
    vestiaire d'un client modifie devient la boutique entiere, gratuite.
  */
  it('refuse d equiper ce qu on ne possede pas', async () => {
    const repo = repository();
    await expect(service(repo).equip('p-1', { auraEffect: 'fx.galaxy' })).rejects.toMatchObject({
      reason: 'NOT_OWNED',
    });
    expect(repo.state.loadout).toBeNull();
  });

  it('accepte un gratuit sans qu il soit en base', async () => {
    const repo = repository();
    await service(repo).equip('p-1', { auraColor: 'color.gold' });
    expect(repo.state.loadout).toEqual({ auraColor: 'color.gold' });
  });

  it('accepte un equipement vide : c est un retour aux defauts', async () => {
    const repo = repository();
    await service(repo).equip('p-1', {});
    expect(repo.state.loadout).toEqual({});
  });
});

describe('InventoryError', () => {
  it('porte sa raison', () => {
    expect(new InventoryError('UNKNOWN_ITEM').reason).toBe('UNKNOWN_ITEM');
  });
});
