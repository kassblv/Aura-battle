import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SystemClock } from '../../../shared/clock.js';
import { INVENTORY_WRITE_QUEUE, InventoryService } from '../application/inventory.js';
import { INVENTORY_RATE_LIMITS, InventoryRateLimit } from '../application/inventory-rate-limit.js';
import type { CatalogueEntry } from '../domain/purchase.js';
import type { InventoryRepository, LoadoutData, PlayerInventory } from '../domain/ports.js';
import { InventoryController } from './inventory.controller.js';

/**
 * Les routes d'inventaire, par HTTP, dans un vrai Fastify.
 *
 * Ce que seul le transport montre : le 429 et son corps, la limite comptee
 * par JOUEUR et avant tout travail, et une reponse faite de l'etat que le
 * service a ecrit — sans relecture de la base.
 */

const CATALOGUE: readonly CatalogueEntry[] = [
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
    id: 'color.violet',
    kind: 'AURA_COLOR',
    rarity: 'common',
    priceSoft: 80,
    priceHard: null,
    availableFrom: null,
    availableTo: null,
  },
];

/** Le joueur dont les ecritures de loadout ne reviennent jamais. */
const STALLED = 'p-stalled';

/** Un depot en memoire par joueur, qui compte ses lectures. */
const stores = new Map<string, PlayerInventory>();
let reads = 0;
const repository: InventoryRepository = {
  catalogue: () => Promise.resolve(CATALOGUE),
  read: (playerId) => {
    reads += 1;
    return Promise.resolve(
      stores.get(playerId) ?? { wallet: { soft: 1_000, hard: 0 }, owned: [], loadout: null },
    );
  },
  grant: (playerId, itemId, spend) => {
    const before = stores.get(playerId) ?? {
      wallet: { soft: 1_000, hard: 0 },
      owned: [],
      loadout: null,
    };
    const wallet = { soft: before.wallet.soft - spend.soft, hard: before.wallet.hard - spend.hard };
    stores.set(playerId, { ...before, wallet, owned: [...before.owned, itemId] });
    return Promise.resolve(wallet);
  },
  setLoadout: (playerId, data: LoadoutData) => {
    // Une base muette pour ce seul joueur : l'ecriture ne revient jamais.
    if (playerId === STALLED) return new Promise<never>(() => undefined);
    const before = stores.get(playerId) ?? {
      wallet: { soft: 1_000, hard: 0 },
      owned: [],
      loadout: null,
    };
    stores.set(playerId, { ...before, loadout: data });
    return Promise.resolve();
  },
};

/** L'heure du serveur, figee : la limite ne se recharge que si on l'avance. */
let nowMs = 1_000_000;
let app: NestFastifyApplication;

beforeAll(async () => {
  const clock = { now: () => new Date(nowMs) };
  const moduleRef = await Test.createTestingModule({
    controllers: [InventoryController],
    providers: [
      {
        provide: InventoryService,
        useValue: new InventoryService({ inventory: repository, clock }),
      },
      { provide: InventoryRateLimit, useValue: new InventoryRateLimit() },
      { provide: SystemClock, useValue: clock },
      {
        provide: 'ACCESS_TOKEN_VERIFIER',
        useValue: {
          verify: (token: string) =>
            token.startsWith('jwt.')
              ? Promise.resolve({ sub: token.slice(4) })
              : Promise.reject(new Error('jeton invalide')),
        },
      },
    ],
  }).compile();

  app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
});

afterAll(async () => {
  await app.close();
});

const equip = (playerId: string, body: unknown = { auraColor: 'color.gold' }) =>
  app.inject({
    method: 'PUT',
    url: '/inventory/loadout',
    headers: { authorization: `Bearer jwt.${playerId}` },
    payload: body as Record<string, unknown>,
  });

const buy = (playerId: string, itemId: string) =>
  app.inject({
    method: 'POST',
    url: '/inventory/buy',
    headers: { authorization: `Bearer jwt.${playerId}` },
    payload: { itemId },
  });

const read = (playerId: string) =>
  app.inject({
    method: 'GET',
    url: '/inventory',
    headers: { authorization: `Bearer jwt.${playerId}` },
  });

describe('GET /inventory', () => {
  it('rend l inventaire du joueur', async () => {
    const reply = await read('p-reader');
    expect(reply.statusCode).toBe(200);
    expect(reply.json<{ owned: string[] }>().owned).toEqual(['color.gold']);
  });

  /*
    Une lecture coute une requete pour le jeton et trois pour l'inventaire :
    sans borne, c'etait la route la moins chere pour vider le pool Postgres.
  */
  it('refuse une boucle de lectures en 429, avant toute lecture', async () => {
    const { capacity, refillPerSecond } = INVENTORY_RATE_LIMITS.read;
    for (let i = 0; i < capacity; i++) {
      expect((await read('p-readloop')).statusCode).toBe(200);
    }

    reads = 0;
    const refused = await read('p-readloop');
    expect(refused.statusCode).toBe(429);
    expect(refused.json()).toEqual({ code: 'RATE_LIMITED', message: 'RATE_LIMITED' });
    expect(reads).toBe(0);

    nowMs += Math.ceil(1_000 / refillPerSecond);
    expect((await read('p-readloop')).statusCode).toBe(200);
  });

  /* Lire en boucle ne doit pas empecher d'equiper : chaque route a son seau. */
  it('n entame pas le seau des equipements', async () => {
    while ((await read('p-readfirst')).statusCode === 200);
    expect((await equip('p-readfirst')).statusCode).toBe(200);
  });
});

describe('PUT /inventory/loadout', () => {
  it('repond avec l etat enregistre, en une seule lecture', async () => {
    reads = 0;
    const reply = await equip('p-once');

    expect(reply.statusCode).toBe(200);
    expect(reply.json()).toEqual({
      wallet: { soft: 1_000, hard: 0 },
      owned: ['color.gold'],
      loadout: { auraColor: 'color.gold' },
    });
    expect(reads).toBe(1);
  });

  /*
    Une douzaine de requetes SQL par appel avant ce correctif : un compte
    invite en boucle epuisait le pool Postgres. La rafale passe, le reste
    recoit un 429 avec un code que le client sait traduire.
  */
  it('refuse une boucle en 429 RATE_LIMITED, puis se recharge', async () => {
    const { capacity, refillPerSecond } = INVENTORY_RATE_LIMITS.loadout;
    for (let i = 0; i < capacity; i++) {
      expect((await equip('p-loop')).statusCode).toBe(200);
    }

    reads = 0;
    const refused = await equip('p-loop');
    expect(refused.statusCode).toBe(429);
    expect(refused.json()).toEqual({ code: 'RATE_LIMITED', message: 'RATE_LIMITED' });
    // Refuse AVANT tout travail : pas une lecture de plus.
    expect(reads).toBe(0);

    nowMs += Math.ceil(1_000 / refillPerSecond);
    expect((await equip('p-loop')).statusCode).toBe(200);
  });

  /* Un corps invalide coute un jeton aussi : sinon la boucle passerait par la. */
  it('compte aussi les corps invalides', async () => {
    const { capacity } = INVENTORY_RATE_LIMITS.loadout;
    for (let i = 0; i < capacity; i++) {
      expect((await equip('p-junk', { outfit: 42 })).statusCode).toBe(400);
    }
    expect((await equip('p-junk', { outfit: 42 })).statusCode).toBe(429);
  });

  it('ne coute rien aux autres joueurs', async () => {
    while ((await equip('p-noisy')).statusCode === 200);
    expect((await equip('p-calm')).statusCode).toBe(200);
  });

  /* Sans jeton, pas de joueur a qui compter : 401, et aucun seau cree. */
  it('reste en 401 sans session', async () => {
    const reply = await app.inject({ method: 'PUT', url: '/inventory/loadout', payload: {} });
    expect(reply.statusCode).toBe(401);
  });
});

describe('POST /inventory/buy', () => {
  // 2.2.0 : la monnaie traverse le controleur ; une monnaie inconnue est refusee.
  it('transmet la monnaie choisie jusqu a la regle d achat', async () => {
    const reply = await app.inject({
      method: 'POST',
      url: '/inventory/buy',
      headers: { authorization: 'Bearer jwt.p-currency' },
      payload: { itemId: 'color.violet', currency: 'hard' },
    });
    // color.violet n'a pas de prix en jetons : payer en jetons est impossible.
    expect(reply.statusCode).not.toBe(201);
    expect(reply.statusCode).toBe(403);
    expect(reply.json<{ code: string }>().code).toBe('NOT_PURCHASABLE');
  });

  it('refuse une monnaie inconnue', async () => {
    const reply = await app.inject({
      method: 'POST',
      url: '/inventory/buy',
      headers: { authorization: 'Bearer jwt.p-currency2' },
      payload: { itemId: 'color.violet', currency: 'gems' },
    });
    expect(reply.statusCode).toBe(400);
  });

  it('repond avec la bourse debitee, sans relire', async () => {
    reads = 0;
    const reply = await buy('p-shop', 'color.violet');

    expect(reply.statusCode).toBe(201);
    // La bourse de la transaction (le prix peut etre remise par la vitrine).
    const wallet = reply.json<{ wallet: { soft: number } }>().wallet;
    expect(wallet).toEqual(stores.get('p-shop')?.wallet);
    expect(wallet.soft).toBeLessThan(1_000);
    expect(reply.json<{ owned: string[] }>().owned).toEqual(
      expect.arrayContaining(['color.violet', 'color.gold']),
    );
    expect(reads).toBe(1);
  });

  it('refuse une boucle d achats en 429', async () => {
    const { capacity } = INVENTORY_RATE_LIMITS.buy;
    // Des achats refuses par le domaine (objet inconnu) comptent aussi.
    for (let i = 0; i < capacity; i++) {
      expect((await buy('p-buyloop', 'color.inexistante')).statusCode).toBe(404);
    }
    const refused = await buy('p-buyloop', 'color.violet');
    expect(refused.statusCode).toBe(429);
    expect(refused.json<{ code: string }>().code).toBe('RATE_LIMITED');
  });
});

/*
  La limite de debit borne le RYTHME des ecritures, pas leur file : derriere
  une base muette, un debit legal suffisait a l'allonger sans fin.
*/
describe('file d ecritures pleine', () => {
  it('refuse en 429 RATE_LIMITED, sans gener les autres joueurs', async () => {
    // Laissees pendantes : c'est a la base de les conclure, pas au test.
    for (let i = 0; i < INVENTORY_WRITE_QUEUE.maxDepth; i += 1) void equip(STALLED);
    // Le temps que les requetes traversent l'authentification jusqu'a la file.
    await new Promise((done) => setTimeout(done, 50));

    const refused = await equip(STALLED);
    expect(refused.statusCode).toBe(429);
    expect(refused.json()).toEqual({ code: 'RATE_LIMITED', message: 'RATE_LIMITED' });

    expect((await equip('p-beside-stalled')).statusCode).toBe(200);
  });
});
