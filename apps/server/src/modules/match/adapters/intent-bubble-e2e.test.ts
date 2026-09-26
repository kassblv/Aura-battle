import { defaultAnimationFor } from '@aura/content';
import { PROTOCOL_VERSION, type ServerMessage } from '@aura/protocol';
import { BALANCE, type BalanceConfig, type Style } from '@aura/rules';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { IoAdapter } from '@nestjs/platform-socket.io';
import { Test } from '@nestjs/testing';
import { io, type Socket as ClientSocket } from 'socket.io-client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadConfig } from '../../../shared/config.js';
import { createLogger, PinoLoggerService } from '../../../shared/logger.js';
import { MessageMetrics } from '../../../shared/metrics.js';
import { SocketAuthenticator } from '../../auth/application/socket-auth.js';
import { FeatureFlags } from '../../flags/application/feature-flags.js';
import type { FlagAssignmentEntry } from '../../flags/domain/ports.js';
import { InviteService } from '../application/invites.js';
import { MatchRuntime } from '../application/match-runtime.js';
import { matchmakingTestProviders } from '../application/testing-wiring.js';
import { PLAYER_DIRECTORY } from '../domain/directory.js';
import type { MatchRecord, MatchRepository } from '../domain/ports.js';
import { PLAYER_WARDROBE } from '../domain/wardrobe.js';
import { MatchGateway } from './match.gateway.js';
import { SocketNotifier } from './socket-notifier.js';
import { SystemMatchClock, TimeoutScheduler } from './timeout-scheduler.js';

/**
 * Bulle d'intention en test A/B, de bout en bout (spec 2026-09-26) : deux
 * clients Socket.IO, la vraie passerelle, le vrai runtime, la vraie file.
 *
 * **Les groupes sont imposes, pas devines.** `FeatureFlags` recoit une
 * affectation injectee : un identifiant qui commence par `ctl` est temoin,
 * tout autre est expose. Chercher des identifiants dont le hachage tombe du
 * bon cote rendrait la suite dependante d'une fonction qu'elle ne teste pas.
 */

const FAST: BalanceConfig = {
  ...BALANCE,
  phases: { introMs: 20, rechargeMs: 40, choiceMs: 2_000, revealMs: 20 },
};

const serverConfig = loadConfig({
  DATABASE_URL: 'postgresql://inutilise',
  REDIS_URL: 'redis://inutilise',
  JWT_SECRET: 'un-secret-assez-long',
  NODE_ENV: 'test',
});

const subjectOf = (token: string): string | null =>
  token.startsWith('jwt.') && token.length > 4 ? token.slice(4) : null;

/** Identifiants distincts par scenario : le notifier indexe les sockets par joueur. */
let counter = 0;
const treated = (): string => `ib_${String((counter += 1))}`;
const control = (): string => `ctl_ib_${String((counter += 1))}`;

class SavedMatches implements MatchRepository {
  readonly records: MatchRecord[] = [];
  save(record: MatchRecord): Promise<void> {
    this.records.push(record);
    return Promise.resolve();
  }
  async of(matchId: string): Promise<MatchRecord> {
    const deadline = Date.now() + 5_000;
    for (;;) {
      const found = this.records.find((record) => record.matchId === matchId);
      if (found !== undefined) return found;
      if (Date.now() > deadline) throw new Error(`match ${matchId} jamais enregistre`);
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
  }
}

const saved = new SavedMatches();
const enrolled: FlagAssignmentEntry[] = [];

let app: NestFastifyApplication;
let url: string;

/** Enregistre tout ce qu'une socket recoit, des sa connexion (`onAny`). */
class Recorder {
  readonly received: { name: string; payload: unknown }[] = [];

  constructor(
    readonly socket: ClientSocket,
    readonly playerId: string,
  ) {
    socket.onAny((name: string, payload: unknown) => {
      this.received.push({ name, payload });
    });
  }

  all<T>(name: string): T[] {
    return this.received.filter((m) => m.name === name).map((m) => m.payload as T);
  }

  async nth<T>(name: string, index = 1, timeoutMs = 6_000): Promise<T> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const found = this.all<T>(name);
      if (found.length >= index) return found[index - 1]!;
      if (Date.now() > deadline) {
        throw new Error(
          `« ${name} » n°${String(index)} n'est jamais arrive (recus : ${this.received
            .map((m) => m.name)
            .join(', ')})`,
        );
      }
      await new Promise((resolve) => setTimeout(resolve, 15));
    }
  }

  first<T>(name: string, timeoutMs = 6_000): Promise<T> {
    return this.nth<T>(name, 1, timeoutMs);
  }
}

const record = (playerId: string): Promise<Recorder> =>
  new Promise((resolve) => {
    const socket = io(url, {
      transports: ['websocket'],
      auth: { token: `jwt.${playerId}`, protocolVersion: PROTOCOL_VERSION },
      forceNew: true,
    });
    const recorder = new Recorder(socket, playerId);
    socket.on('connect', () => {
      resolve(recorder);
    });
  });

const close = (...recorders: Recorder[]): void => {
  for (const r of recorders) r.socket.disconnect();
};

const pause = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

beforeAll(async () => {
  const flags = new FeatureFlags({
    rollouts: { intentBubble: 50 },
    clock: { now: () => Date.now() },
    store: {
      record: (entry: FlagAssignmentEntry) => {
        enrolled.push(entry);
        return Promise.resolve();
      },
    },
    assign: (_flag, playerId) => (playerId.startsWith('ctl') ? 'control' : 'treatment'),
  });

  const moduleRef = await Test.createTestingModule({
    providers: [
      MatchGateway,
      InviteService,
      TimeoutScheduler,
      SystemMatchClock,
      { provide: MessageMetrics, useFactory: () => new MessageMetrics(false) },
      {
        provide: PinoLoggerService,
        useValue: new PinoLoggerService(createLogger(serverConfig)),
      },
      {
        provide: SocketAuthenticator,
        useValue: new SocketAuthenticator({
          verify: (token: string) => {
            const sub = subjectOf(token);
            return sub === null
              ? Promise.reject(new Error('jeton invalide'))
              : Promise.resolve({ sub });
          },
        }),
      },
      {
        provide: PLAYER_WARDROBE,
        useValue: { wearingOf: () => Promise.resolve({ ownedEffects: [], owned: [] }) },
      },
      {
        provide: PLAYER_DIRECTORY,
        useValue: {
          displayNames: (ids: readonly string[]) =>
            Promise.resolve(new Map(ids.map((id) => [id, `Joueur ${id}`]))),
        },
      },
      {
        provide: SocketNotifier,
        inject: [PinoLoggerService, MessageMetrics],
        useFactory: (logger: PinoLoggerService, m: MessageMetrics) => new SocketNotifier(logger, m),
      },
      {
        provide: MatchRuntime,
        inject: [SocketNotifier, TimeoutScheduler, SystemMatchClock],
        useFactory: (
          notifier: SocketNotifier,
          scheduler: TimeoutScheduler,
          clock: SystemMatchClock,
        ) => new MatchRuntime(notifier, scheduler, clock, FAST, saved),
      },
      // Pas d'horloge de variante : la semaine ne doit pas changer le resultat.
      ...matchmakingTestProviders({ withWorker: true, flags }),
    ],
  }).compile();

  app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
  app.useWebSocketAdapter(new IoAdapter(app));
  await app.init();
  await app.listen(0, '127.0.0.1');
  url = (await app.getUrl()).replace('[::1]', '127.0.0.1');
});

afterAll(async () => {
  await app?.close();
});

/** Deux joueurs par la file ; `a` est le plus ancien en file. */
async function queued(
  mode: 'casual' | 'ranked',
  idA: string,
  idB: string,
): Promise<{ a: Recorder; b: Recorder; matchId: string }> {
  const first = await record(idA);
  const second = await record(idB);
  first.socket.emit('queue:join', { mode });
  await pause(30);
  second.socket.emit('queue:join', { mode });
  const found = await first.first<ServerMessage<'match:found'>>('match:found');
  await second.first<ServerMessage<'match:found'>>('match:found');
  // Le siege vient de l'annonce, pas d'une supposition sur l'ordre de la file.
  const [a, b] = found.seat === 'a' ? [first, second] : [second, first];
  return { a, b, matchId: found.matchId };
}

/** Deux joueurs par invitation : l'hote est en `a`. */
async function invited(
  idA: string,
  idB: string,
): Promise<{ a: Recorder; b: Recorder; matchId: string }> {
  const a = await record(idA);
  const b = await record(idB);
  a.socket.emit('invite:create');
  const invite = await a.first<ServerMessage<'invite:created'>>('invite:created');
  b.socket.emit('invite:join', { code: invite.code });
  const found = await a.first<ServerMessage<'match:found'>>('match:found');
  await b.first('match:found');
  return { a, b, matchId: found.matchId };
}

const show = (player: Recorder, matchId: string, seq: number, style: Style, round = 1): void => {
  player.socket.emit('intent:show', { matchId, round, seq, style });
};

const lock = (
  player: Recorder,
  matchId: string,
  seq: number,
  style: Style,
  tier: 0 | 1 | 2 | 3 | 4,
): void => {
  player.socket.emit('choice:lock', {
    matchId,
    round: 1,
    seq,
    poseId: defaultAnimationFor({ style, tier }),
    amp: 0,
    ult: false,
    timing: { chargeAt: 0, tapAt: 400 },
  });
};

describe('bulle d intention — match expose', () => {
  it('annonce la bulle, relaie l annonce aux deux sieges, puis la tient a la revelation', async () => {
    const { a, b, matchId } = await queued('casual', treated(), treated());

    expect(a.all<ServerMessage<'match:found'>>('match:found')[0]?.intentBubble).toBe(true);
    expect(b.all<ServerMessage<'match:found'>>('match:found')[0]?.intentBubble).toBe(true);
    // Les deux sieges reels sont inscrits, dans le groupe expose.
    expect(enrolled.filter((e) => [a.playerId, b.playerId].includes(e.playerId))).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ playerId: a.playerId, group: 'treatment' }),
        expect.objectContaining({ playerId: b.playerId, group: 'treatment' }),
      ]),
    );

    const choiceStart = await a.first<ServerMessage<'choice:start'>>('choice:start');
    // Rien n'est parti avant l'annonce.
    expect(b.all('intent:shown')).toEqual([]);

    show(a, matchId, 1, 'calme');
    const expected = { matchId, round: 1, seat: 'a', style: 'calme' };
    expect(await b.first('intent:shown')).toEqual(expected);
    expect(await a.first('intent:shown')).toEqual(expected);

    // Une seconde annonce ne part nulle part : la premiere fait foi.
    show(a, matchId, 2, 'hype');
    await pause(150);
    expect(a.all('intent:shown')).toHaveLength(1);
    expect(b.all('intent:shown')).toHaveLength(1);

    // Une reprise ne perd ni la bulle ni l'annonce de la manche.
    b.socket.emit('match:rejoin', { matchId });
    const snapshot = await b.first<ServerMessage<'match:state'>>('match:state');
    expect(snapshot.intentBubble).toBe(true);
    expect(snapshot.intents).toEqual({ a: 'calme' });

    // `a` gagne en calme : la bulle est tenue, +10 de jauge.
    lock(a, matchId, 3, 'calme', 3);
    lock(b, matchId, 1, 'calme', 0);
    const result = await a.first<ServerMessage<'round:result'>>('round:result');
    expect(result.winner).toBe('a');
    expect(result.sides.a.intentKept).toBe(true);
    expect(result.sides.b.intentKept).toBe(false);
    const perfect = result.sides.a.timing.quality === 'perfect' ? FAST.ultimate.gainOnPerfect : 0;
    expect(result.sides.a.ultAfter).toBe(
      Math.min(FAST.ultimate.gaugeMax, choiceStart.ult + perfect + FAST.intent.ultimateBonus),
    );

    a.socket.emit('match:forfeit', { matchId });
    await b.first('match:end');
    expect((await saved.of(matchId)).intentBubble).toBe(true);
    close(a, b);
  });

  it('refuse une annonce posterieure au verrouillage (invitation)', async () => {
    const { a, b, matchId } = await invited(treated(), treated());
    expect(a.all<ServerMessage<'match:found'>>('match:found')[0]?.intentBubble).toBe(true);
    await b.first('choice:start');

    lock(b, matchId, 1, 'hype', 1);
    await a.first('opponent:locked');
    show(b, matchId, 2, 'hype');
    await pause(150);
    expect(a.all('intent:shown')).toEqual([]);
    expect(b.all('intent:shown')).toEqual([]);

    // L'autre siege, lui, peut encore annoncer.
    show(a, matchId, 1, 'provoc');
    expect(await b.first('intent:shown')).toEqual({
      matchId,
      round: 1,
      seat: 'a',
      style: 'provoc',
    });
    close(a, b);
  });

  it('borne intent:show par la meme limite de debit que tout message', async () => {
    const { a, b, matchId } = await invited(treated(), treated());
    for (let seq = 1; seq <= 120; seq += 1) show(a, matchId, seq, 'calme');
    const error = await a.first<{ code: string }>('error');
    expect(error.code).toBe('RATE_LIMITED');
    close(a, b);
  });
});

describe('bulle d intention — match non expose', () => {
  const expectNoBubble = async (a: Recorder, b: Recorder, matchId: string): Promise<void> => {
    for (const player of [a, b]) {
      expect(player.all('match:found')[0]).not.toHaveProperty('intentBubble');
    }
    await a.first('choice:start');
    show(a, matchId, 1, 'calme');
    show(b, matchId, 1, 'hype');
    await pause(150);
    expect(a.all('intent:shown')).toEqual([]);
    expect(b.all('intent:shown')).toEqual([]);

    b.socket.emit('match:rejoin', { matchId });
    const snapshot = await b.first<ServerMessage<'match:state'>>('match:state');
    expect(snapshot).not.toHaveProperty('intentBubble');
    expect(snapshot).not.toHaveProperty('intents');

    lock(a, matchId, 2, 'calme', 3);
    lock(b, matchId, 2, 'calme', 0);
    const result = await a.first<ServerMessage<'round:result'>>('round:result');
    expect(result.sides.a).not.toHaveProperty('intentKept');
    expect(result.sides.b).not.toHaveProperty('intentKept');
    // Le bonus n'est pas tombe en douce : l'annonce n'a jamais existe.
    const choiceStart = a.all<ServerMessage<'choice:start'>>('choice:start')[0]!;
    const perfect = result.sides.a.timing.quality === 'perfect' ? FAST.ultimate.gainOnPerfect : 0;
    expect(result.sides.a.ultAfter).toBe(
      Math.min(FAST.ultimate.gaugeMax, choiceStart.ult + perfect),
    );
  };

  it('jamais en classe, meme entre deux joueurs exposes', async () => {
    const idA = treated();
    const idB = treated();
    const { a, b, matchId } = await queued('ranked', idA, idB);
    await expectNoBubble(a, b, matchId);
    // Le classe n'inscrit personne a l'experience.
    expect(enrolled.some((e) => e.playerId === idA || e.playerId === idB)).toBe(false);
    a.socket.emit('match:forfeit', { matchId });
    await b.first('match:end');
    expect((await saved.of(matchId)).intentBubble).toBe(false);
    close(a, b);
  });

  it('jamais avec un joueur temoin a la table', async () => {
    const idControl = control();
    const { a, b, matchId } = await queued('casual', treated(), idControl);
    await expectNoBubble(a, b, matchId);
    // Le temoin est inscrit : c'est lui qu'on compare.
    expect(enrolled).toContainEqual(
      expect.objectContaining({ playerId: idControl, group: 'control' }),
    );
    close(a, b);
  });
});
