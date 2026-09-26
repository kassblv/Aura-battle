import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { CONFIG, type ServerConfig } from '../../../shared/config.js';
import type { IndicatorReadings } from '../../analytics/domain/indicators.js';
import { ExperimentsService } from '../../analytics/application/experiments.service.js';
import type { ExperimentGroupReading } from '../../analytics/domain/experiments.js';
import { IndicatorsService } from '../../analytics/application/indicators.service.js';
import { AdminStatusService } from '../application/admin-status.service.js';
import { ADMIN_PAGE } from './admin-page.js';
import { AdminController } from './admin.controller.js';

/**
 * `GET /admin/indicators` : meme garde que `/admin/status` — 404 sans secret
 * configure, 401 sans le bon secret — et la forme de la reponse.
 */

const SECRET = 'secret-d-administration-assez-long';
const config = { adminToken: SECRET } as ServerConfig & { adminToken: string };

const READINGS: IndicatorReadings = {
  indicators: {
    retentionD1: { value: 0.4, n: 50 },
    retentionD7: { value: 0.05, n: 30 },
    matchesPerActiveDay: { value: 5.5, n: 120 },
    medianRankedWaitMs: { value: 31_000, n: 90 },
    clipShareRate: { value: 0.1, n: 5 },
    inviteInstallShare: { value: null, n: 0 },
    abandonRate: { value: 0.02, n: 400 },
  },
  ghostShare: { value: 0.3, n: 400 },
};

const NOW = Date.UTC(2026, 8, 26, 9, 30);
const reads: number[] = [];
const cohortReads: string[] = [];

const GROUP: ExperimentGroupReading = {
  players: 40,
  retentionD1: { value: 0.5, n: 30 },
  retentionD7: { value: null, n: 0 },
  matchesPerActiveDay: { value: 4.2, n: 55 },
  abandonRate: { value: 0.03, n: 120 },
};

let app: NestFastifyApplication;

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({
    controllers: [AdminController],
    providers: [
      { provide: CONFIG, useValue: config },
      { provide: AdminStatusService, useValue: { read: () => Promise.resolve({}) } },
      {
        provide: IndicatorsService,
        useValue: new IndicatorsService({
          reader: {
            read: (nowMs: number) => {
              reads.push(nowMs);
              return Promise.resolve(READINGS);
            },
          },
          clock: { now: () => new Date(NOW) },
        }),
      },
      {
        provide: ExperimentsService,
        useValue: new ExperimentsService({
          reader: {
            readCohort: (_nowMs, cohort) => {
              cohortReads.push(`${cohort.flag}:${cohort.group}`);
              return Promise.resolve(GROUP);
            },
          },
          experiments: { declared: () => [{ flag: 'intentBubble', rollout: 50 }] },
          clock: { now: () => new Date(NOW) },
        }),
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
  config.adminToken = SECRET;
  reads.length = 0;
  cohortReads.length = 0;
});

const indicators = (authorization?: string) =>
  app.inject({
    method: 'GET',
    url: '/admin/indicators',
    headers: authorization === undefined ? {} : { authorization },
  });

describe('GET /admin/indicators', () => {
  it('n existe pas sans secret configure', async () => {
    config.adminToken = '';
    expect((await indicators(`Bearer ${SECRET}`)).statusCode).toBe(404);
    expect(reads).toEqual([]);
  });

  it('refuse sans le bon secret, sans rien calculer', async () => {
    expect((await indicators()).statusCode).toBe(401);
    expect((await indicators('Bearer mauvais')).statusCode).toBe(401);
    expect((await indicators(SECRET)).statusCode).toBe(401);
    expect(reads).toEqual([]);
  });

  it('rend chaque indicateur avec sa valeur, son effectif, son seuil et son verdict', async () => {
    const reply = await indicators(`Bearer ${SECRET}`);
    expect(reply.statusCode).toBe(200);
    expect(reply.headers['cache-control']).toBe('no-store');
    // Calcule a l'heure du serveur, jamais a une heure fournie par l'appelant.
    expect(reads).toEqual([NOW]);

    const body = reply.json<{
      at: string;
      indicators: { id: string; verdict: string; value: number | null; n: number }[];
      ghostShare: { value: number; n: number };
    }>();
    expect(body.at).toBe('2026-09-26T09:30:00.000Z');
    expect(body.ghostShare).toEqual({ value: 0.3, n: 400 });
    expect(body.indicators[3]).toEqual({
      id: 'medianRankedWaitMs',
      label: 'Attente médiane en file classée',
      unit: 'ms',
      value: 31_000,
      n: 90,
      threshold: 20_000,
      comparison: 'lte',
      verdict: 'missed',
    });
    expect(body.indicators.map((line) => [line.id, line.verdict])).toEqual([
      ['retentionD1', 'met'],
      ['retentionD7', 'missed'],
      ['matchesPerActiveDay', 'met'],
      ['medianRankedWaitMs', 'missed'],
      ['clipShareRate', 'insufficient'],
      ['inviteInstallShare', 'insufficient'],
      ['abandonRate', 'met'],
    ]);
  });
});

describe('panneau : section Indicateurs', () => {
  it('interroge la route des indicateurs avec le meme secret que l etat', () => {
    expect(ADMIN_PAGE).toContain('<h2>Indicateurs');
    expect(ADMIN_PAGE).toContain(
      "fetch('/admin/indicators', { headers: { authorization: 'Bearer ' + secret } })",
    );
    expect(ADMIN_PAGE).toContain('échantillon insuffisant');
  });
});

const experiments = (authorization?: string) =>
  app.inject({
    method: 'GET',
    url: '/admin/experiments',
    headers: authorization === undefined ? {} : { authorization },
  });

/** Lecture des tests A/B (spec 2026-09-26) : meme garde que les indicateurs. */
describe('GET /admin/experiments', () => {
  it('n existe pas sans secret configure', async () => {
    config.adminToken = '';
    expect((await experiments(`Bearer ${SECRET}`)).statusCode).toBe(404);
    expect(cohortReads).toEqual([]);
  });

  it('refuse sans le bon secret, sans rien calculer', async () => {
    expect((await experiments()).statusCode).toBe(401);
    expect((await experiments('Bearer mauvais')).statusCode).toBe(401);
    expect(cohortReads).toEqual([]);
  });

  it('rend chaque groupe de chaque experience, avec ses effectifs', async () => {
    const reply = await experiments(`Bearer ${SECRET}`);
    expect(reply.statusCode).toBe(200);
    expect(reply.headers['cache-control']).toBe('no-store');
    expect(reply.json()).toEqual({
      at: '2026-09-26T09:30:00.000Z',
      experiments: [
        { flag: 'intentBubble', rollout: 50, groups: { treatment: GROUP, control: GROUP } },
      ],
    });
    expect(cohortReads.sort()).toEqual(['intentBubble:control', 'intentBubble:treatment']);
  });
});

describe('panneau : section Experiences', () => {
  it('interroge la route des experiences avec le meme secret, sans innerHTML', () => {
    expect(ADMIN_PAGE).toContain('<h2>Expériences');
    expect(ADMIN_PAGE).toContain(
      "fetch('/admin/experiments', { headers: { authorization: 'Bearer ' + secret } })",
    );
    // Des donnees venues de la base ne s'ecrivent jamais comme du balisage.
    expect(ADMIN_PAGE).not.toMatch(/innerHTML|outerHTML|insertAdjacentHTML|document\.write/);
  });
});
