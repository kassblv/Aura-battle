import { weekEventSchema } from '@aura/protocol';
import { weekIndexOf } from '@aura/rules';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { RuleEventsService } from '../application/rule-events.service.js';
import { WeekEventController } from './week-event.controller.js';

/**
 * `GET /events/week` (protocole 2.7.0) : la semaine telle que le serveur
 * l'appliquera, forcage compris, pour un joueur authentifie.
 */
const NOW = Date.UTC(2026, 8, 26, 15);
const WEEK = weekIndexOf(NOW);

let app: NestFastifyApplication;
const service = new RuleEventsService({
  store: {
    loadFrom: () => Promise.resolve(new Map([[WEEK, 'contres']])),
    setOverride: () => Promise.resolve(),
  },
  clock: { now: () => NOW },
});

beforeAll(async () => {
  await service.refresh();
  const moduleRef = await Test.createTestingModule({
    controllers: [WeekEventController],
    providers: [
      { provide: RuleEventsService, useValue: service },
      {
        provide: 'ACCESS_TOKEN_VERIFIER',
        useValue: {
          verify: (token: string) =>
            token === 'bon' ? Promise.resolve({ sub: 'p1' }) : Promise.reject(new Error('non')),
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

const week = (authorization?: string) =>
  app.inject({
    method: 'GET',
    url: '/events/week',
    headers: authorization === undefined ? {} : { authorization },
  });

describe('GET /events/week', () => {
  it('refuse sans session valide', async () => {
    expect((await week()).statusCode).toBe(401);
    expect((await week('Bearer mauvais')).statusCode).toBe(401);
  });

  it('rend la semaine en cours, forcage compris, au format du protocole', async () => {
    const reply = await week('Bearer bon');
    expect(reply.statusCode).toBe(200);
    const body = reply.json<unknown>();
    expect(weekEventSchema.parse(body)).toEqual({
      week: WEEK,
      variant: 'contres',
      endsAt: '2026-09-28T00:00:00.000Z',
    });
  });
});
