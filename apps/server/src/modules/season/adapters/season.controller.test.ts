import { discountedPrice, SEASON_PASS } from '@aura/content';
import { seasonStateSchema, type SeasonState } from '@aura/protocol';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { SystemClock } from '../../../shared/clock.js';
import type {
  InventoryChanges,
  InventoryRepository,
  InventorySnapshot,
  PlayerInventory,
} from '../../inventory/domain/ports.js';
import type { CatalogueEntry } from '../../inventory/domain/purchase.js';
import type { ClaimKey, SeasonGrant } from '../domain/claim.js';
import {
  SeasonConflictError,
  type CurrentSeason,
  type SeasonProgress,
  type SeasonRepository,
} from '../domain/ports.js';
import { SeasonService } from '../application/season.js';
import { SEASON_RATE_LIMITS, SeasonRateLimit } from '../application/season-rate-limit.js';
import { SeasonController } from './season.controller.js';

/**
 * Les routes du passe, par HTTP, dans un vrai Fastify, sur le vrai passe
 * (`SEASON_PASS`) et des depots en memoire.
 *
 * Ce que seul le transport montre : la forme exacte de la reponse (validee
 * par le schema du protocole), les codes HTTP de chaque refus, et la limite
 * comptee par joueur.
 */

const SEASON: CurrentSeason = {
  id: 's_1',
  number: 1,
  endsAt: new Date('2026-10-27T00:00:00Z'),
};

const CATALOGUE: readonly CatalogueEntry[] = [
  {
    id: 'color.violet',
    kind: 'AURA_COLOR',
    rarity: 'common',
    priceSoft: 80,
    priceHard: 8,
    availableFrom: null,
    availableTo: null,
  },
  {
    id: 'anim.acrobatie.t2.splitleap',
    kind: 'ANIMATION',
    rarity: 'rare',
    priceSoft: 300,
    priceHard: 30,
    availableFrom: null,
    availableTo: null,
  },
];

interface PlayerRow {
  xp: number;
  premium: boolean;
  claimed: ClaimKey[];
  soft: number;
  hard: number;
  owned: string[];
}

const players = new Map<string, PlayerRow>();
let season: CurrentSeason | null = SEASON;
const notified: { playerId: string; snapshot: InventorySnapshot }[] = [];

const row = (playerId: string): PlayerRow => {
  let found = players.get(playerId);
  if (found === undefined) {
    found = { xp: 0, premium: false, claimed: [], soft: 0, hard: 0, owned: [] };
    players.set(playerId, found);
  }
  return found;
};

/** La base en memoire, avec les memes gardes que Postgres. */
const seasons: SeasonRepository = {
  current: () => Promise.resolve(season),
  progress: (playerId): Promise<SeasonProgress> => {
    const { xp, premium, claimed } = row(playerId);
    return Promise.resolve({ xp, premium, claimed: [...claimed] });
  },
  grant: (playerId, _seasonId, grants: readonly SeasonGrant[]) => {
    const player = row(playerId);
    // La cle primaire : une seule reclamation deja la, et tout le lot tombe.
    if (grants.some((g) => player.claimed.some((c) => c.tier === g.tier && c.track === g.track))) {
      return Promise.reject(new SeasonConflictError('ALREADY_CLAIMED'));
    }
    for (const grant of grants) {
      player.claimed.push({ tier: grant.tier, track: grant.track });
      player.soft += grant.coins;
      player.hard += grant.tokens;
      if (grant.itemId === null) continue;
      if (player.owned.includes(grant.itemId)) player.soft += grant.fallbackCoins;
      else player.owned.push(grant.itemId);
    }
    return Promise.resolve();
  },
  buyPremium: (playerId, _seasonId, price) => {
    const player = row(playerId);
    if (player.premium) return Promise.reject(new SeasonConflictError('ALREADY_PREMIUM'));
    if (player.hard < price) return Promise.reject(new SeasonConflictError('INSUFFICIENT_FUNDS'));
    player.premium = true;
    player.hard -= price;
    return Promise.resolve();
  },
};

const inventory: Pick<InventoryRepository, 'catalogue' | 'read'> = {
  catalogue: () => Promise.resolve(CATALOGUE),
  read: (playerId): Promise<PlayerInventory> => {
    const player = row(playerId);
    return Promise.resolve({
      wallet: { soft: player.soft, hard: player.hard },
      owned: [...player.owned],
      loadout: null,
    });
  },
};

const changes: InventoryChanges = {
  changed: (playerId, snapshot) => {
    notified.push({ playerId, snapshot });
    return Promise.resolve();
  },
};

let nowMs = Date.parse('2026-09-25T12:00:00Z');
let app: NestFastifyApplication;

beforeAll(async () => {
  const clock = { now: () => new Date(nowMs) };
  const moduleRef = await Test.createTestingModule({
    controllers: [SeasonController],
    providers: [
      {
        provide: SeasonService,
        useValue: new SeasonService({ seasons, inventory, clock, changes }),
      },
      { provide: SeasonRateLimit, useValue: new SeasonRateLimit() },
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

beforeEach(() => {
  season = SEASON;
  notified.length = 0;
  // Chaque test avance l'horloge d'une minute : les seaux sont pleins.
  nowMs += 60_000;
});

const auth = (playerId: string) => ({ authorization: `Bearer jwt.${playerId}` });

const read = (playerId: string) =>
  app.inject({ method: 'GET', url: '/season', headers: auth(playerId) });

const claim = (playerId: string, body: unknown) =>
  app.inject({
    method: 'POST',
    url: '/season/claim',
    headers: auth(playerId),
    payload: body as Record<string, unknown>,
  });

const claimAll = (playerId: string) =>
  app.inject({ method: 'POST', url: '/season/claim-all', headers: auth(playerId) });

const premium = (playerId: string) =>
  app.inject({ method: 'POST', url: '/season/premium', headers: auth(playerId) });

/** La reponse, validee par le schema du protocole : jamais une forme a peu pres. */
const stateOf = (reply: { json: () => unknown }): SeasonState =>
  seasonStateSchema.parse(reply.json());

describe('GET /season', () => {
  it('exige un jeton', async () => {
    const reply = await app.inject({ method: 'GET', url: '/season' });
    expect(reply.statusCode).toBe(401);
    const forged = await app.inject({
      method: 'GET',
      url: '/season',
      headers: { authorization: 'Bearer forged' },
    });
    expect(forged.statusCode).toBe(401);
  });

  it('rend l etat du joueur, conforme au protocole', async () => {
    players.set('p-read', {
      xp: 250,
      premium: false,
      claimed: [{ tier: 1, track: 'free' }],
      soft: 12,
      hard: 3,
      owned: [],
    });
    const reply = await read('p-read');
    expect(reply.statusCode).toBe(200);
    expect(stateOf(reply)).toEqual({
      season: { number: 1, endsAt: '2026-10-27T00:00:00.000Z' },
      xp: 250,
      tier: 2,
      premium: false,
      claimed: [{ tier: 1, track: 'free' }],
      wallet: { soft: 12, hard: 3 },
    });
  });

  it('rend une saison nulle hors saison, avec la bourse', async () => {
    season = null;
    players.set('p-off', { xp: 0, premium: false, claimed: [], soft: 7, hard: 0, owned: [] });
    const state = stateOf(await read('p-off'));
    expect(state).toMatchObject({ season: null, xp: 0, tier: 0, wallet: { soft: 7, hard: 0 } });
  });
});

describe('POST /season/claim', () => {
  it('accorde la recompense du catalogue, et rend l etat apres coup', async () => {
    players.set('p-claim', { xp: 100, premium: false, claimed: [], soft: 0, hard: 0, owned: [] });
    const reply = await claim('p-claim', { tier: 1, track: 'free' });
    expect(reply.statusCode).toBe(201);
    const state = stateOf(reply);
    const reward = SEASON_PASS.tiers[0]!.free;
    expect(reward.kind).toBe('coins');
    expect(state.wallet.soft).toBe(reward.kind === 'coins' ? reward.amount : -1);
    expect(state.claimed).toEqual([{ tier: 1, track: 'free' }]);
  });

  it('refuse une seconde reclamation en 409', async () => {
    players.set('p-twice', { xp: 100, premium: false, claimed: [], soft: 0, hard: 0, owned: [] });
    expect((await claim('p-twice', { tier: 1, track: 'free' })).statusCode).toBe(201);
    const again = await claim('p-twice', { tier: 1, track: 'free' });
    expect(again.statusCode).toBe(409);
    expect(again.json<{ code: string }>().code).toBe('ALREADY_CLAIMED');
    expect(row('p-twice').soft).toBe(40);
  });

  it('refuse un palier non atteint et une piste premium absente en 403', async () => {
    players.set('p-locked', { xp: 150, premium: false, claimed: [], soft: 0, hard: 0, owned: [] });
    const locked = await claim('p-locked', { tier: 2, track: 'free' });
    expect(locked.statusCode).toBe(403);
    expect(locked.json<{ code: string }>().code).toBe('TIER_LOCKED');

    const premiumOnly = await claim('p-locked', { tier: 1, track: 'premium' });
    expect(premiumOnly.statusCode).toBe(403);
    expect(premiumOnly.json<{ code: string }>().code).toBe('PREMIUM_REQUIRED');
    expect(row('p-locked').claimed).toEqual([]);
  });

  it('refuse un corps invalide en 400, montant compris', async () => {
    for (const body of [
      {},
      { tier: 0, track: 'free' },
      { tier: 31, track: 'free' },
      { tier: 1, track: 'gold' },
      { tier: 1, track: 'free', coins: 9_999 },
    ]) {
      const reply = await claim('p-bad', body);
      expect(reply.statusCode, JSON.stringify(body)).toBe(400);
    }
  });

  it('rend 404 NO_SEASON hors saison', async () => {
    season = null;
    const reply = await claim('p-none', { tier: 1, track: 'free' });
    expect(reply.statusCode).toBe(404);
    expect(reply.json<{ code: string }>().code).toBe('NO_SEASON');
  });

  it('previent le match quand un cosmetique est accorde', async () => {
    players.set('p-item', { xp: 1_000, premium: false, claimed: [], soft: 0, hard: 0, owned: [] });
    await claim('p-item', { tier: 10, track: 'free' });
    expect(row('p-item').owned).toEqual(['color.violet']);
    expect(notified.map((n) => n.playerId)).toEqual(['p-item']);
    expect(notified[0]?.snapshot.owned).toContain('color.violet');
  });

  it('change en pieces un cosmetique deja possede, sans prevenir le match', async () => {
    players.set('p-owned', {
      xp: 1_000,
      premium: false,
      claimed: [],
      soft: 0,
      hard: 0,
      owned: ['color.violet'],
    });
    const state = stateOf(await claim('p-owned', { tier: 10, track: 'free' }));
    expect(state.wallet.soft).toBe(discountedPrice(80));
    expect(notified).toEqual([]);
  });

  it('limite les reclamations par joueur, en 429', async () => {
    players.set('p-flood', { xp: 0, premium: false, claimed: [], soft: 0, hard: 0, owned: [] });
    const statuses: number[] = [];
    for (let i = 0; i <= SEASON_RATE_LIMITS.claim.capacity; i += 1) {
      statuses.push((await claim('p-flood', { tier: 1, track: 'free' })).statusCode);
    }
    expect(statuses.slice(0, -1).every((status) => status === 403)).toBe(true);
    expect(statuses.at(-1)).toBe(429);
    // Un autre joueur n'en patit pas.
    players.set('p-calm', { xp: 100, premium: false, claimed: [], soft: 0, hard: 0, owned: [] });
    expect((await claim('p-calm', { tier: 1, track: 'free' })).statusCode).toBe(201);
  });
});

describe('POST /season/claim-all', () => {
  it('accorde tout ce qui est atteint sur les pistes du joueur', async () => {
    players.set('p-all', { xp: 520, premium: true, claimed: [], soft: 0, hard: 0, owned: [] });
    const state = stateOf(await claimAll('p-all'));
    expect(state.claimed.length).toBe(10);
    // Gratuit 1-5 : 4 x 40 pieces et 5 jetons ; premium 1-5 : un objet, 60,
    // 20 jetons, 60, un objet (color.white, absent du catalogue de test :
    // change en 40 pieces).
    expect(state.wallet).toEqual({ soft: 160 + 60 + 60 + 40, hard: 5 + 20 });
    expect(row('p-all').owned).toEqual(['anim.acrobatie.t2.splitleap']);
  });

  it('ne fait rien quand il n y a rien a prendre', async () => {
    players.set('p-empty', { xp: 50, premium: false, claimed: [], soft: 3, hard: 0, owned: [] });
    const reply = await claimAll('p-empty');
    expect(reply.statusCode).toBe(201);
    expect(stateOf(reply)).toMatchObject({ claimed: [], wallet: { soft: 3, hard: 0 } });
  });
});

describe('POST /season/premium', () => {
  it('debite exactement le prix en jetons, puis ouvre la piste', async () => {
    players.set('p-buy', { xp: 250, premium: false, claimed: [], soft: 999, hard: 600, owned: [] });
    const state = stateOf(await premium('p-buy'));
    expect(state.premium).toBe(true);
    expect(state.wallet).toEqual({ soft: 999, hard: 600 - SEASON_PASS.premiumPrice });
  });

  it('refuse sans assez de jetons en 403, sans rien ecrire', async () => {
    players.set('p-poor', {
      xp: 0,
      premium: false,
      claimed: [],
      soft: 50_000,
      hard: 499,
      owned: [],
    });
    const reply = await premium('p-poor');
    expect(reply.statusCode).toBe(403);
    expect(reply.json<{ code: string }>().code).toBe('INSUFFICIENT_FUNDS');
    expect(row('p-poor')).toMatchObject({ premium: false, hard: 499 });
  });

  it('refuse un second achat en 409', async () => {
    players.set('p-again', { xp: 0, premium: true, claimed: [], soft: 0, hard: 5_000, owned: [] });
    const reply = await premium('p-again');
    expect(reply.statusCode).toBe(409);
    expect(reply.json<{ code: string }>().code).toBe('ALREADY_PREMIUM');
    expect(row('p-again').hard).toBe(5_000);
  });
});
