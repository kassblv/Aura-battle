import {
  adminAuditResponseSchema,
  adminEventsResponseSchema,
  adminFlagsResponseSchema,
  adminPlayerDetailSchema,
  adminPlayerSearchResponseSchema,
} from '@aura/protocol';
import { weekIndexOf } from '@aura/rules';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { AdminAuditEntry } from '../../../shared/admin-audit.js';
import { CONFIG, type ServerConfig } from '../../../shared/config.js';
import { FeatureFlags } from '../../flags/application/feature-flags.js';
import type { FlagName, FlagSettingState } from '../../flags/domain/flags.js';
import type { FlagSettingsStore } from '../../flags/domain/ports.js';
import { RuleEventsService } from '../../rule-events/application/rule-events.service.js';
import type { RuleEventStore } from '../../rule-events/domain/ports.js';
import { AdminGate } from '../application/admin-gate.js';
import { AdminPlayersService } from '../application/admin-players.service.js';
import {
  ADMIN_AUDIT_READER,
  type AdminAuditReader,
  type AdminAuditRow,
  type AdminPlayerDetailRow,
  type AdminPlayerStore,
  type StoredBan,
} from '../domain/ports.js';
import { AdminGuard } from './admin.guard.js';
import { AdminManageController } from './admin-manage.controller.js';

/**
 * Les ecritures du panneau (ADR 0018), par HTTP, dans un vrai Fastify.
 *
 * Pour chaque route : 404 sans `ADMIN_TOKEN`, 401 sans le bon secret, 400 sur
 * un corps invalide, et le journal ecrit avec l'ecriture. Les services sont
 * les vrais ; seuls les depots sont en memoire — une seule liste de journal,
 * partagee, comme la table.
 */
const SECRET = 'secret-d-administration-assez-long';
const config = { adminToken: SECRET } as ServerConfig & { adminToken: string };
const NOW = Date.UTC(2026, 8, 26, 12);
const WEEK = weekIndexOf(NOW);
const journal: AdminAuditEntry[] = [];

class Settings implements FlagSettingsStore {
  rows = new Map<FlagName, FlagSettingState>();
  loadAll(initial: readonly FlagSettingState[]): Promise<FlagSettingState[]> {
    for (const state of initial) if (!this.rows.has(state.flag)) this.rows.set(state.flag, state);
    return Promise.resolve([...this.rows.values()]);
  }
  transition(
    flag: FlagName,
    next: (current: FlagSettingState) => FlagSettingState,
    audit: (before: FlagSettingState, after: FlagSettingState) => AdminAuditEntry,
  ): Promise<FlagSettingState> {
    const before = this.rows.get(flag)!;
    const after = next(before);
    this.rows.set(flag, after);
    journal.push(audit(before, after));
    return Promise.resolve(after);
  }
}

class Events implements RuleEventStore {
  rows = new Map<number, string>();
  loadFrom(fromWeek: number): Promise<ReadonlyMap<number, string>> {
    return Promise.resolve(new Map([...this.rows].filter(([week]) => week >= fromWeek)));
  }
  setOverride(
    week: number,
    variant: string | null,
    audit: (before: string | null) => AdminAuditEntry,
  ): Promise<void> {
    journal.push(audit(this.rows.get(week) ?? null));
    if (variant === null) this.rows.delete(week);
    else this.rows.set(week, variant);
    return Promise.resolve();
  }
}

const PLAYER: AdminPlayerDetailRow = {
  id: 'p_banni',
  displayName: 'Aura Banni',
  createdAt: new Date(NOW - 86_400_000),
  lastSeenAt: new Date(NOW),
  ban: null,
  xp: 10,
  softCurrency: 1,
  hardCurrency: 0,
  league: null,
  recentMatches: [],
};

class Players implements AdminPlayerStore {
  rows = new Map<string, AdminPlayerDetailRow>();
  searched: string[] = [];
  search(q: string) {
    this.searched.push(q);
    return Promise.resolve([...this.rows.values()].filter((row) => row.displayName.includes(q)));
  }
  detail(playerId: string) {
    return Promise.resolve(this.rows.get(playerId) ?? null);
  }
  setBan(
    playerId: string,
    ban: StoredBan | null,
    audit: (before: StoredBan | null) => AdminAuditEntry,
  ) {
    const row = this.rows.get(playerId);
    if (row === undefined) return Promise.resolve(false);
    journal.push(audit(row.ban));
    this.rows.set(playerId, { ...row, ban });
    return Promise.resolve(true);
  }
}

class Audit implements AdminAuditReader {
  asked: { filter: unknown; limit: number }[] = [];
  latest(filter: { action?: string; target?: string }, limit: number): Promise<AdminAuditRow[]> {
    this.asked.push({ filter, limit });
    return Promise.resolve(
      journal
        .map((entry, i) => ({
          id: `a${String(i)}`,
          at: new Date(entry.atMs),
          action: entry.action,
          target: entry.target,
          before: entry.before,
          after: entry.after,
          reason: entry.reason,
        }))
        .reverse(),
    );
  }
}

const settings = new Settings();
const events = new Events();
const players = new Players();
const audit = new Audit();
const published: string[] = [];
const flags = new FeatureFlags({
  rollouts: { intentBubble: 50 },
  clock: { now: () => NOW },
  settings,
});
const ruleEvents = new RuleEventsService({ store: events, clock: { now: () => NOW } });

let app: NestFastifyApplication;

beforeAll(async () => {
  await flags.refresh();
  const moduleRef = await Test.createTestingModule({
    controllers: [AdminManageController],
    providers: [
      { provide: CONFIG, useValue: config },
      {
        provide: AdminGate,
        useValue: new AdminGate({ token: () => config.adminToken, now: () => NOW }),
      },
      AdminGuard,
      { provide: FeatureFlags, useValue: flags },
      { provide: RuleEventsService, useValue: ruleEvents },
      {
        provide: AdminPlayersService,
        useValue: new AdminPlayersService({
          store: players,
          clock: { now: () => NOW },
          bans: { publish: (id) => published.push(id) },
        }),
      },
      { provide: ADMIN_AUDIT_READER, useValue: audit },
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
  players.rows.set(PLAYER.id, PLAYER);
});

/** Une adresse par appel refuse : la limite d'essais a son propre test. */
let address = 0;
const call = (
  method: 'GET' | 'PUT' | 'POST',
  url: string,
  payload?: unknown,
  authorization: string | null = `Bearer ${SECRET}`,
) =>
  app.inject({
    method,
    url,
    remoteAddress: `10.1.${String((address += 1) >> 8)}.${String(address & 255)}`,
    headers: authorization === null ? {} : { authorization },
    ...(payload === undefined ? {} : { payload: payload as object }),
  });

const WRITES: [string, 'PUT' | 'POST', string, unknown][] = [
  ['drapeau', 'PUT', '/admin/flags/intentBubble', { action: 'pause' }],
  ['evenement', 'PUT', `/admin/events/${String(WEEK)}`, { variant: 'ultime' }],
  ['bannissement', 'POST', '/admin/players/p_banni/ban', { until: null, reason: 'motif valable' }],
  ['levee', 'POST', '/admin/players/p_banni/unban', { reason: 'motif valable' }],
];

describe('garde commune a chaque route du panneau', () => {
  const READS = [
    '/admin/flags',
    '/admin/events',
    '/admin/players?q=aura',
    '/admin/players/p_banni',
    '/admin/audit',
  ];

  it.each(READS)('GET %s : 404 sans secret configure, 401 sans le bon secret', async (url) => {
    config.adminToken = '';
    expect((await call('GET', url)).statusCode).toBe(404);
    config.adminToken = SECRET;
    expect((await call('GET', url, undefined, null)).statusCode).toBe(401);
    expect((await call('GET', url, undefined, 'Bearer mauvais')).statusCode).toBe(401);
    expect((await call('GET', url)).statusCode).toBe(200);
  });

  it.each(WRITES)(
    '%s : 404 sans secret, 401 sans le bon, rien d ecrit',
    async (_name, method, url, body) => {
      const before = journal.length;
      config.adminToken = '';
      expect((await call(method, url, body)).statusCode).toBe(404);
      config.adminToken = SECRET;
      expect((await call(method, url, body, 'Bearer mauvais')).statusCode).toBe(401);
      expect(journal.length).toBe(before);
      expect(published).not.toContain('jamais');
    },
  );

  it('10 essais rates par minute et par adresse, puis 429 meme avec le bon secret', async () => {
    const inject = (authorization: string) =>
      app.inject({
        method: 'GET',
        url: '/admin/flags',
        remoteAddress: '203.0.113.9',
        headers: { authorization },
      });
    for (let i = 0; i < 10; i += 1) expect((await inject('Bearer faux')).statusCode).toBe(401);
    expect((await inject('Bearer faux')).statusCode).toBe(429);
    expect((await inject(`Bearer ${SECRET}`)).statusCode).toBe(429);
    // Les appels reussis d'une autre adresse ne sont pas limites ainsi.
    for (let i = 0; i < 30; i += 1) {
      const ok = await app.inject({
        method: 'GET',
        url: '/admin/flags',
        remoteAddress: '203.0.113.10',
        headers: { authorization: `Bearer ${SECRET}` },
      });
      expect(ok.statusCode).toBe(200);
    }
  });
});

describe('drapeaux', () => {
  it('GET /admin/flags rend le reglage et la mesure de chaque drapeau', async () => {
    const reply = await call('GET', '/admin/flags');
    expect(reply.headers['cache-control']).toBe('no-store');
    const body = adminFlagsResponseSchema.parse(reply.json());
    expect(body.flags[0]).toEqual({
      flag: 'intentBubble',
      rollout: expect.any(Number) as number,
      measureRollout: expect.any(Number) as number,
      epoch: expect.any(Number) as number,
      measureStartedAt: expect.any(String) as string,
    });
  });

  it('refuse un corps invalide (400) et un drapeau inconnu (404), sans rien journaliser', async () => {
    const before = journal.length;
    expect(
      (await call('PUT', '/admin/flags/intentBubble', { action: 'set', rollout: 30 })).statusCode,
    ).toBe(400);
    expect(
      (await call('PUT', '/admin/flags/intentBubble', { action: 'new-measure', rollout: 0 }))
        .statusCode,
    ).toBe(400);
    expect(
      (await call('PUT', '/admin/flags/intentBubble', { action: 'pause', extra: 1 })).statusCode,
    ).toBe(400);
    expect((await call('PUT', '/admin/flags/inconnu', { action: 'pause' })).statusCode).toBe(404);
    expect(journal.length).toBe(before);
  });

  it('nouvelle mesure : l epoque monte, la reponse et le journal le disent', async () => {
    const epoch = flags.declared()[0]!.epoch;
    const reply = await call('PUT', '/admin/flags/intentBubble', {
      action: 'new-measure',
      rollout: 25,
      reason: 'mesure a 25 %',
    });
    expect(reply.statusCode).toBe(200);
    const body = adminFlagsResponseSchema.parse(reply.json());
    expect(body.flags[0]).toMatchObject({ rollout: 25, measureRollout: 25, epoch: epoch + 1 });
    expect(journal.at(-1)).toMatchObject({
      action: 'flag.new-measure',
      target: 'intentBubble',
      reason: 'mesure a 25 %',
    });
  });
});

describe('evenements', () => {
  it('GET /admin/events : cinq semaines et les variantes', async () => {
    const body = adminEventsResponseSchema.parse((await call('GET', '/admin/events')).json());
    expect(body.weeks).toHaveLength(5);
    expect(body.weeks[0]?.week).toBe(WEEK);
  });

  it('force puis rend a la rotation, journal a chaque fois', async () => {
    let reply = await call('PUT', `/admin/events/${String(WEEK + 1)}`, {
      variant: 'contres',
      reason: 'semaine test',
    });
    expect(reply.statusCode).toBe(200);
    expect(adminEventsResponseSchema.parse(reply.json()).weeks[1]).toMatchObject({
      variant: 'contres',
      source: 'override',
    });
    expect(ruleEvents.overrideFor(WEEK + 1)).toBe('contres');
    reply = await call('PUT', `/admin/events/${String(WEEK + 1)}`, { variant: null });
    expect(reply.statusCode).toBe(200);
    expect(ruleEvents.overrideFor(WEEK + 1)).toBeNull();
    expect(journal.slice(-2).map((entry) => entry.action)).toEqual([
      'event.override',
      'event.override',
    ]);
  });

  it('400 : variante inconnue, semaine passee, semaine illisible, corps invalide', async () => {
    const before = journal.length;
    expect(
      (await call('PUT', `/admin/events/${String(WEEK)}`, { variant: 'inventee' })).statusCode,
    ).toBe(400);
    expect(
      (await call('PUT', `/admin/events/${String(WEEK - 1)}`, { variant: 'normal' })).statusCode,
    ).toBe(400);
    expect((await call('PUT', '/admin/events/abc', { variant: 'normal' })).statusCode).toBe(400);
    expect((await call('PUT', `/admin/events/${String(WEEK)}`, {})).statusCode).toBe(400);
    expect(journal.length).toBe(before);
  });
});

describe('joueurs', () => {
  it('recherche : 400 sans saisie, resultats au format du contrat', async () => {
    expect((await call('GET', '/admin/players')).statusCode).toBe(400);
    expect((await call('GET', `/admin/players?q=${'x'.repeat(65)}`)).statusCode).toBe(400);
    const body = adminPlayerSearchResponseSchema.parse(
      (await call('GET', '/admin/players?q=Banni')).json(),
    );
    expect(body.players.map((player) => player.id)).toEqual(['p_banni']);
  });

  it('fiche : 404 pour un inconnu', async () => {
    expect((await call('GET', '/admin/players/inconnu')).statusCode).toBe(404);
    expect(
      adminPlayerDetailSchema.parse((await call('GET', '/admin/players/p_banni')).json()).id,
    ).toBe('p_banni');
  });

  it('bannit, journalise, previent le match ; puis leve', async () => {
    const reply = await call('POST', '/admin/players/p_banni/ban', {
      until: new Date(NOW + 3_600_000).toISOString(),
      reason: 'triche avérée',
    });
    expect(reply.statusCode).toBe(200);
    expect(adminPlayerDetailSchema.parse(reply.json()).ban?.reason).toBe('triche avérée');
    expect(published).toContain('p_banni');
    expect(journal.at(-1)).toMatchObject({ action: 'player.ban', target: 'p_banni' });

    const lifted = await call('POST', '/admin/players/p_banni/unban', {
      reason: 'erreur de ma part',
    });
    expect(lifted.statusCode).toBe(200);
    expect(adminPlayerDetailSchema.parse(lifted.json()).ban).toBeNull();
    expect(journal.at(-1)).toMatchObject({ action: 'player.unban' });
  });

  it('400 : motif manquant ou trop court, fin passee ; 404 : joueur inconnu', async () => {
    const before = journal.length;
    expect((await call('POST', '/admin/players/p_banni/ban', { until: null })).statusCode).toBe(
      400,
    );
    expect(
      (await call('POST', '/admin/players/p_banni/ban', { until: null, reason: 'x' })).statusCode,
    ).toBe(400);
    expect(
      (
        await call('POST', '/admin/players/p_banni/ban', {
          until: new Date(NOW - 1).toISOString(),
          reason: 'motif valable',
        })
      ).statusCode,
    ).toBe(400);
    expect((await call('POST', '/admin/players/p_banni/unban', {})).statusCode).toBe(400);
    expect(
      (await call('POST', '/admin/players/inconnu/ban', { until: null, reason: 'motif valable' }))
        .statusCode,
    ).toBe(404);
    expect(journal.length).toBe(before);
  });
});

describe('journal', () => {
  it('rend les dernieres actions au format du contrat, 100 au plus, filtres transmis', async () => {
    const reply = await call('GET', '/admin/audit?action=player.ban&target=p_banni');
    expect(reply.statusCode).toBe(200);
    adminAuditResponseSchema.parse(reply.json());
    expect(audit.asked.at(-1)).toEqual({
      filter: { action: 'player.ban', target: 'p_banni' },
      limit: 100,
    });
    await call('GET', '/admin/audit');
    expect(audit.asked.at(-1)).toEqual({ filter: {}, limit: 100 });
  });

  it('refuse un filtre hors bornes', async () => {
    expect((await call('GET', `/admin/audit?action=${'a'.repeat(41)}`)).statusCode).toBe(400);
    expect((await call('GET', '/admin/audit?action=DROP%20TABLE')).statusCode).toBe(400);
    expect((await call('GET', `/admin/audit?target=${'t'.repeat(81)}`)).statusCode).toBe(400);
  });
});
