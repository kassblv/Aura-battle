import { animationIdsFor, defaultAnimationFor } from '@aura/content';
import { describe, expect, it } from 'vitest';
import { InventoryError, InventoryService } from './inventory.js';
import type { CatalogueEntry } from '../domain/purchase.js';
import {
  PurchaseConflictError,
  type InventoryRepository,
  type InventorySnapshot,
  type PlayerInventory,
} from '../domain/ports.js';

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
  /** Lectures de l'inventaire en base : chacune coute plusieurs requetes. */
  const reads = { count: 0 };
  /** Achats qu'on force a perdre la course, une fois chacun. */
  let collideOnce = false;
  /** Erreur que le prochain accord leve, une fois. */
  let failure: Error | null = null;

  const port: InventoryRepository = {
    catalogue: () => Promise.resolve(CATALOGUE),
    read: () => {
      reads.count += 1;
      // Une COPIE, comme la base : muter l'etat apres coup ne doit pas
      // reecrire ce que le service a deja lu.
      return Promise.resolve({ ...state, owned: [...state.owned] });
    },
    grant: (_playerId, itemId, spend) => {
      if (failure !== null) {
        const next = failure;
        failure = null;
        return Promise.reject(next);
      }
      if (collideOnce) {
        collideOnce = false;
        return Promise.reject(new PurchaseConflictError('ALREADY_OWNED'));
      }
      if (state.owned.includes(itemId)) {
        return Promise.reject(new PurchaseConflictError('ALREADY_OWNED'));
      }
      debits.push(spend);
      (state.owned as string[]).push(itemId);
      (state as { wallet: { soft: number; hard: number } }).wallet = {
        soft: state.wallet.soft - spend.soft,
        hard: state.wallet.hard - spend.hard,
      };
      return Promise.resolve(state.wallet);
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
    reads,
    collideNext: () => {
      collideOnce = true;
    },
    failNext: (error: Error) => {
      failure = error;
    },
  };
}

const service = (
  repo: ReturnType<typeof repository>,
  changed?: (playerId: string, snapshot: InventorySnapshot) => void,
  warnings?: string[],
) =>
  new InventoryService({
    inventory: repo.port,
    clock: { now: () => new Date('2026-09-21') },
    ...(warnings === undefined
      ? {}
      : { log: { warn: (message: string) => void warnings.push(message) } }),
    ...(changed === undefined
      ? {}
      : {
          changes: {
            changed: (playerId: string, snapshot: InventorySnapshot) => {
              changed(playerId, snapshot);
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

  /*
    La garde de debit de la base : deux objets DIFFERENTS, payables chacun mais
    pas ensemble. Le perdant manque de pieces — pas « tu le possedes deja ».
  */
  it('traduit la garde de debit en bourse insuffisante', async () => {
    const repo = repository();
    repo.failNext(new PurchaseConflictError('INSUFFICIENT_FUNDS'));

    await expect(service(repo).buy('p-1', 'color.violet')).rejects.toMatchObject({
      reason: 'INSUFFICIENT_FUNDS',
    });
    expect(repo.debits).toHaveLength(0);
  });

  /*
    Toute autre erreur est une PANNE, pas un refus : la deguiser en « deja
    possede » la rendait invisible. Relancee, elle devient un 500 et se voit.
    Le journal ne garde que son nom et son code : le message d'une erreur
    Prisma recopie les arguments refuses.
  */
  it('relance une panne de la base, sans prevenir le match', async () => {
    const repo = repository();
    const down = Object.assign(new Error('insert into "InventoryItem" values (secret)'), {
      code: 'P1001',
    });
    down.name = 'PrismaClientKnownRequestError';
    repo.failNext(down);
    const warnings: string[] = [];
    const seen: string[] = [];

    const failed = service(repo, (id) => seen.push(id), warnings).buy('p-1', 'color.violet');
    await expect(failed).rejects.toBe(down);
    expect(seen).toEqual([]);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('PrismaClientKnownRequestError');
    expect(warnings[0]).toContain('P1001');
    expect(warnings[0]).not.toContain('secret');
  });

  it('se tait sur un refus attendu', async () => {
    const repo = repository();
    repo.collideNext();
    const warnings: string[] = [];

    await expect(service(repo, undefined, warnings).buy('p-1', 'color.violet')).rejects.toThrow();
    expect(warnings).toEqual([]);
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

/*
  Un `PUT /inventory/loadout` coutait une douzaine de requetes : `equip`
  relisait l'inventaire, le match le relisait pour se rafraichir, puis le
  controleur le relisait pour repondre. En boucle depuis un compte invite, de
  quoi epuiser le pool Postgres. Une seule lecture, et l'etat qu'elle a donne
  sert aux trois.
*/
describe('une seule lecture par ecriture', () => {
  it('equip rend l inventaire tel qu il est enregistre, sans relire', async () => {
    const repo = repository({ owned: [FLOSS] });
    const after = await service(repo).equip('p-1', { dances: { 'hype.t2': FLOSS } });

    expect(repo.reads.count).toBe(1);
    expect(after.loadout).toEqual({ dances: { 'hype.t2': FLOSS } });
    // Les offerts comptent, comme a la lecture.
    expect(after.owned).toEqual(expect.arrayContaining([FLOSS, 'color.gold']));
  });

  it('buy rend la bourse debitee et l objet possede, sans relire', async () => {
    const repo = repository();
    const after = await service(repo).buy('p-1', 'color.violet');

    expect(repo.reads.count).toBe(1);
    expect(after.wallet).toEqual({ soft: 920, hard: 0 });
    expect(after.owned).toEqual(expect.arrayContaining(['color.violet', 'color.gold']));
  });

  it('previent le match avec ce qui vient d etre enregistre', async () => {
    const seen: InventorySnapshot[] = [];
    const repo = repository({ owned: [FLOSS] });
    await service(repo, (_id, snapshot) => seen.push(snapshot)).equip('p-1', {
      signature: FLOSS,
    });

    expect(seen).toHaveLength(1);
    expect(seen[0]?.loadout).toEqual({ signature: FLOSS });
    expect(seen[0]?.owned).toEqual(expect.arrayContaining([FLOSS, 'color.gold']));
  });

  it('previent le match de l objet achete', async () => {
    const seen: InventorySnapshot[] = [];
    await service(repository(), (_id, snapshot) => seen.push(snapshot)).buy('p-1', 'color.violet');
    expect(seen[0]?.owned).toContain('color.violet');
  });
});

/** Une porte qu'on ouvre a la main, pour choisir l'ordre des fins. */
function gate(): { opened: Promise<void>; open: () => void } {
  let open!: () => void;
  const opened = new Promise<void>((done) => {
    open = done;
  });
  return { opened, open };
}

/** Laisse s'ecouler toutes les microtaches en attente. */
const settle = () => new Promise((done) => setImmediate(done));

/*
  Deux ecritures simultanees du meme joueur — deux touchers rapides au
  vestiaire, ou un achat suivi d'un equipement. Sans ordre, chacune lisait,
  ecrivait et prevenait le match a son rythme : le match pouvait garder
  l'avant-dernier loadout, ou perdre de `ownedEffects` l'effet tout juste
  achete.
*/
describe('ecritures concurrentes d un meme joueur', () => {
  /** Un depot dont la PREMIERE ecriture de loadout traine. */
  function slowFirstWrite() {
    const repo = repository({ owned: ['color.violet'] });
    const setLoadout = repo.port.setLoadout.bind(repo.port);
    const slow = gate();
    let calls = 0;
    repo.port.setLoadout = async (playerId, data) => {
      calls += 1;
      if (calls === 1) await slow.opened;
      return setLoadout(playerId, data);
    };
    return { repo, release: slow.open };
  }

  it('previent le match dans l ordre : le dernier etat notifie est la derniere ecriture', async () => {
    const { repo, release } = slowFirstWrite();
    const notified: InventorySnapshot[] = [];
    const inventory = service(repo, (_playerId, snapshot) => notified.push(snapshot));

    const first = inventory.equip('p-1', { auraColor: 'color.violet' });
    const second = inventory.equip('p-1', { auraColor: 'color.gold' });
    await settle();
    release();
    await Promise.all([first, second]);

    expect(notified.map((snapshot) => snapshot.loadout)).toEqual([
      { auraColor: 'color.violet' },
      { auraColor: 'color.gold' },
    ]);
    expect(repo.state.loadout).toEqual({ auraColor: 'color.gold' });
  });

  it('un equipement lance pendant un achat voit l effet achete', async () => {
    const repo = repository();
    const grant = repo.port.grant.bind(repo.port);
    const slow = gate();
    repo.port.grant = async (playerId, itemId, spend) => {
      await slow.opened;
      return grant(playerId, itemId, spend);
    };
    const notified: InventorySnapshot[] = [];
    const inventory = service(repo, (_playerId, snapshot) => notified.push(snapshot));

    const bought = inventory.buy('p-1', 'fx.galaxy');
    const equipped = inventory.equip('p-1', { auraEffect: 'fx.galaxy' });
    await settle();
    slow.open();

    await bought;
    // Sans ordre, l'equipement lisait l'inventaire avant l'achat : NOT_OWNED.
    await expect(equipped).resolves.toMatchObject({ loadout: { auraEffect: 'fx.galaxy' } });
    const last = notified.at(-1);
    expect(last?.owned).toContain('fx.galaxy');
    expect(last?.loadout).toEqual({ auraEffect: 'fx.galaxy' });
  });

  it('un refus ne bloque pas l ecriture suivante du joueur', async () => {
    const inventory = service(repository());

    const refused = inventory.equip('p-1', { auraEffect: 'fx.galaxy' });
    const accepted = inventory.equip('p-1', { auraColor: 'color.gold' });

    await expect(refused).rejects.toMatchObject({ reason: 'NOT_OWNED' });
    await expect(accepted).resolves.toMatchObject({ loadout: { auraColor: 'color.gold' } });
  });

  it('ne fait pas attendre un joueur derriere un autre', async () => {
    const { repo, release } = slowFirstWrite();
    const inventory = service(repo);

    const blocked = inventory.equip('p-1', { auraColor: 'color.violet' });
    await settle();
    await expect(inventory.equip('p-2', { auraColor: 'color.gold' })).resolves.toBeDefined();
    release();
    await blocked;
  });
});

describe('InventoryError', () => {
  it('porte sa raison', () => {
    expect(new InventoryError('UNKNOWN_ITEM').reason).toBe('UNKNOWN_ITEM');
  });
});
