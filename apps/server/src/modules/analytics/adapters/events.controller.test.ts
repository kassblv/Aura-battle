import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { SystemClock } from '../../../shared/clock.js';
import type { ProductEventEntry, ProductEventStore } from '../domain/ports.js';
import { EVENTS_RATE_LIMIT, EventsRateLimit } from '../application/events-rate-limit.js';
import { ProductEventsService } from '../application/product-events.js';
import { EventsController } from './events.controller.js';

/**
 * `POST /events`, par HTTP, dans un vrai Fastify, sur un depot en memoire qui
 * applique la meme regle que Postgres : n'inscrire qu'un joueur assis au
 * match, une seule fois par (joueur, match, sorte).
 */

const MATCH = 'm_7f0c1d2e-3a4b-4c5d-8e6f-708192a3b4c5';
const OTHER_MATCH = 'm_00000000-0000-4000-8000-000000000000';

/** Qui etait assis a quel match. */
const seats = new Map<string, string[]>([[MATCH, ['p-seated', 'p-flood']]]);

class MemoryStore implements ProductEventStore {
  readonly rows: ProductEventEntry[] = [];
  recordIfSeated(entry: ProductEventEntry): Promise<boolean> {
    if (!(seats.get(entry.matchId) ?? []).includes(entry.playerId)) return Promise.resolve(false);
    const duplicate = this.rows.some(
      (row) =>
        row.playerId === entry.playerId && row.matchId === entry.matchId && row.kind === entry.kind,
    );
    if (duplicate) return Promise.resolve(false);
    this.rows.push(entry);
    return Promise.resolve(true);
  }
}

const store = new MemoryStore();
let nowMs = Date.parse('2026-09-26T12:00:00Z');
let app: NestFastifyApplication;

beforeAll(async () => {
  const clock = { now: () => new Date(nowMs) };
  const moduleRef = await Test.createTestingModule({
    controllers: [EventsController],
    providers: [
      { provide: ProductEventsService, useValue: new ProductEventsService({ store, clock }) },
      { provide: EventsRateLimit, useValue: new EventsRateLimit() },
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
  store.rows.length = 0;
  // Une minute plus tard a chaque test : les seaux sont pleins.
  nowMs += 60_000;
});

const post = (body: unknown, playerId: string | null = 'p-seated') =>
  app.inject({
    method: 'POST',
    url: '/events',
    headers: playerId === null ? {} : { authorization: `Bearer jwt.${playerId}` },
    payload: body as Record<string, unknown>,
  });

describe('POST /events', () => {
  it('inscrit le clip d un joueur assis au match, et repond 204 sans corps', async () => {
    const reply = await post({ kind: 'clip_shared', matchId: MATCH });
    expect(reply.statusCode).toBe(204);
    expect(reply.body).toBe('');
    expect(store.rows).toEqual([
      { playerId: 'p-seated', matchId: MATCH, kind: 'clip_shared', atMs: nowMs },
    ]);
  });

  it('n inscrit qu une ligne quand le client renvoie', async () => {
    expect((await post({ kind: 'clip_shared', matchId: MATCH })).statusCode).toBe(204);
    expect((await post({ kind: 'clip_shared', matchId: MATCH })).statusCode).toBe(204);
    expect(store.rows).toHaveLength(1);
  });

  it('n inscrit rien pour un match ou le joueur n etait pas assis, et repond pareil', async () => {
    const reply = await post({ kind: 'clip_shared', matchId: OTHER_MATCH });
    expect(reply.statusCode).toBe(204);
    expect(reply.body).toBe('');
    expect((await post({ kind: 'clip_shared', matchId: MATCH }, 'p-stranger')).statusCode).toBe(
      204,
    );
    expect(store.rows).toEqual([]);
  });

  it('refuse sans jeton, ou avec un jeton invalide, en 401', async () => {
    expect((await post({ kind: 'clip_shared', matchId: MATCH }, null)).statusCode).toBe(401);
    const forged = await app.inject({
      method: 'POST',
      url: '/events',
      headers: { authorization: 'Bearer forged' },
      payload: { kind: 'clip_shared', matchId: MATCH },
    });
    expect(forged.statusCode).toBe(401);
    expect(store.rows).toEqual([]);
  });

  it('refuse un corps inconnu en 400', async () => {
    for (const [index, body] of [
      {},
      { kind: 'clip_shared' },
      { kind: 'page_view', matchId: MATCH },
      { kind: 'clip_shared', matchId: 'pas un match' },
      { kind: 'clip_shared', matchId: 'm_'.padEnd(65, 'x') },
      { kind: 'clip_shared', matchId: MATCH, playerId: 'p-autre' },
    ].entries()) {
      // Un joueur par corps : sept envois d'affilee videraient le seau d'un seul.
      const reply = await post(body, `p-bad-${String(index)}`);
      expect(reply.statusCode, JSON.stringify(body)).toBe(400);
    }
    expect(store.rows).toEqual([]);
  });

  it('limite le debit par joueur, en 429', async () => {
    const statuses: number[] = [];
    for (let i = 0; i <= EVENTS_RATE_LIMIT.capacity; i += 1) {
      statuses.push((await post({ kind: 'clip_shared', matchId: MATCH }, 'p-flood')).statusCode);
    }
    expect(statuses.slice(0, -1).every((status) => status === 204)).toBe(true);
    expect(statuses.at(-1)).toBe(429);
    // Un autre joueur n'en patit pas.
    expect((await post({ kind: 'clip_shared', matchId: MATCH })).statusCode).toBe(204);
  });
});
