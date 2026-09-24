import { animationIdsFor, defaultAnimationFor } from '@aura/content';
import { describe, expect, it } from 'vitest';
import { InventoryError, InventoryService } from './inventory.js';
import type { CatalogueEntry } from '../domain/purchase.js';
import type { InventoryRepository, PlayerInventory } from '../domain/ports.js';

const CATALOGUE: readonly CatalogueEntry[] = [
  {
    id: 'color.violet',
    kind: 'AURA_COLOR',
    rarity: 'common',
    priceSoft: 80,
    priceHard: null,
    availableFrom: null,
    availableTo: null,
  },
  {
    id: 'color.gold',
    kind: 'AURA_COLOR',
    rarity: 'default',
    priceSoft: 0,
    priceHard: null,
    availableFrom: null,
    availableTo: null,
  },
  {
    id: 'fx.galaxy',
    kind: 'AURA_EFFECT',
    rarity: 'epic',
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

const service = (repo: ReturnType<typeof repository>, changed?: (playerId: string) => void) =>
  new InventoryService({
    inventory: repo.port,
    clock: { now: () => new Date('2026-09-21') },
    ...(changed === undefined
      ? {}
      : {
          changes: {
            changed: (playerId: string) => {
              changed(playerId);
              return Promise.resolve();
            },
          },
        }),
  });

/** Une danse payante d'un mouvement, et l'offerte d'un autre. */
const FLOSS = animationIdsFor({ style: 'hype', tier: 2 })[1]!;
const CALME_T0 = defaultAnimationFor({ style: 'calme', tier: 0 });

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

  /*
    Une danse s'equipe POUR SON mouvement. Le client refusait deja de jouer
    une danse rangee sous le mauvais mouvement ; le serveur, lui, l'annoncait
    a la revelation — un calme palier 0 danse comme un hype palier 2 chez
    l'adversaire, qui lirait un coup qui n'a pas ete joue.
  */
  it('refuse une danse rangee sous un autre mouvement', async () => {
    const repo = repository({ owned: [FLOSS] });
    await expect(
      service(repo).equip('p-1', { dances: { 'calme.t0': FLOSS } }),
    ).rejects.toMatchObject({ reason: 'WRONG_SLOT' });
    expect(repo.state.loadout).toBeNull();
  });

  it('accepte une danse possedee sous son mouvement', async () => {
    const repo = repository({ owned: [FLOSS] });
    await service(repo).equip('p-1', { dances: { 'hype.t2': FLOSS } });
    expect(repo.state.loadout).toEqual({ dances: { 'hype.t2': FLOSS } });
  });

  it('accepte une signature possedee', async () => {
    const repo = repository({ owned: [FLOSS] });
    await service(repo).equip('p-1', { signature: FLOSS });
    expect(repo.state.loadout).toEqual({ signature: FLOSS });
  });

  it('refuse une signature qu on ne possede pas', async () => {
    const repo = repository();
    await expect(service(repo).equip('p-1', { signature: FLOSS })).rejects.toMatchObject({
      reason: 'NOT_OWNED',
    });
  });

  /* Une couleur possedee n'est pas une danse : la signature se joue, elle ne se peint pas. */
  it('refuse une signature qui n est pas une danse de mouvement', async () => {
    const repo = repository({ owned: ['color.violet'] });
    await expect(service(repo).equip('p-1', { signature: 'color.violet' })).rejects.toMatchObject({
      reason: 'WRONG_SLOT',
    });
  });

  /*
    Chaque emplacement a SON kind. Sans ce controle, une danse rangee sous
    `auraColor` partait telle quelle chez l'adversaire, dans
    `opponent.cosmetics` — une couleur qui n'en est pas une.
  */
  it.each([
    ['une danse en couleur d aura', { auraColor: FLOSS }],
    ['une couleur en tenue', { outfit: 'color.violet' }],
    ['un effet en coiffure', { hair: 'fx.galaxy' }],
    ['une couleur en effet d aura', { auraEffect: 'color.violet' }],
  ])('refuse %s', async (_why, loadout) => {
    const repo = repository({ owned: [FLOSS, 'color.violet', 'fx.galaxy'] });
    await expect(service(repo).equip('p-1', loadout)).rejects.toMatchObject({
      reason: 'WRONG_SLOT',
    });
    expect(repo.state.loadout).toBeNull();
  });

  it('accepte chaque kind dans son emplacement', async () => {
    const repo = repository({ owned: ['color.violet', 'fx.galaxy'] });
    await service(repo).equip('p-1', { auraColor: 'color.violet', auraEffect: 'fx.galaxy' });
    expect(repo.state.loadout).toEqual({ auraColor: 'color.violet', auraEffect: 'fx.galaxy' });
  });

  it('accepte l offerte d un mouvement en signature', async () => {
    const repo = repository({ owned: [CALME_T0] });
    await service(repo).equip('p-1', { signature: CALME_T0 });
    expect(repo.state.loadout).toEqual({ signature: CALME_T0 });
  });
});

/*
  Le module match lit ce que porte un joueur a sa connexion. Sans ce signal,
  une danse equipee au vestiaire n'etait vue par l'adversaire qu'apres une
  reconnexion — et une danse choisie en plein duel, jamais.
*/
describe('signal de changement', () => {
  it('previent apres un equipement enregistre', async () => {
    const seen: string[] = [];
    await service(repository({ owned: [FLOSS] }), (id) => seen.push(id)).equip('p-1', {
      dances: { 'hype.t2': FLOSS },
    });
    expect(seen).toEqual(['p-1']);
  });

  it('previent apres un achat : posseder un effet, c est le porter', async () => {
    const seen: string[] = [];
    await service(repository(), (id) => seen.push(id)).buy('p-1', 'color.violet');
    expect(seen).toEqual(['p-1']);
  });

  it('se tait quand l equipement est refuse', async () => {
    const seen: string[] = [];
    await expect(
      service(repository(), (id) => seen.push(id)).equip('p-1', { signature: FLOSS }),
    ).rejects.toBeInstanceOf(InventoryError);
    expect(seen).toEqual([]);
  });
});

describe('InventoryError', () => {
  it('porte sa raison', () => {
    expect(new InventoryError('UNKNOWN_ITEM').reason).toBe('UNKNOWN_ITEM');
  });
});
