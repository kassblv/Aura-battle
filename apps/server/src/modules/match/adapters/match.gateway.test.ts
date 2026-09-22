import { PROTOCOL_VERSION } from '@aura/protocol';
import { Test } from '@nestjs/testing';
import { IoAdapter } from '@nestjs/platform-socket.io';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { io, type Socket as ClientSocket } from 'socket.io-client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadConfig } from '../../../shared/config.js';
import { createLogger, PinoLoggerService } from '../../../shared/logger.js';
import { MessageMetrics } from '../../../shared/metrics.js';
import { SocketAuthenticator } from '../../auth/application/socket-auth.js';
import { InviteService } from '../application/invites.js';
import { PLAYER_DIRECTORY } from '../domain/directory.js';
import { PLAYER_WARDROBE } from '../domain/wardrobe.js';
import { MatchRuntime } from '../application/match-runtime.js';
import { matchmakingTestProviders } from '../application/testing-wiring.js';
import { MatchGateway } from './match.gateway.js';
import { SocketNotifier } from './socket-notifier.js';
import { SystemMatchClock, TimeoutScheduler } from './timeout-scheduler.js';

/**
 * Tests de bout en bout de la passerelle, avec un vrai client Socket.IO.
 *
 * Aucune base de donnees : le verificateur de jeton est remplace par un double,
 * ce qui isole exactement ce qu'on veut eprouver — les trois filtres du
 * handshake, du debit et du schema.
 */

const config = loadConfig({
  DATABASE_URL: 'postgresql://inutilise',
  REDIS_URL: 'redis://inutilise',
  JWT_SECRET: 'un-secret-assez-long',
  NODE_ENV: 'test',
});

let app: NestFastifyApplication;
let url: string;

/**
 * Ouvre une socket **sans attendre** la connexion.
 *
 * Les ecouteurs doivent etre poses avant que le serveur ne parle : dans les cas
 * de refus, il emet son erreur et coupe des l'etablissement de la connexion.
 * Attendre l'evenement `connect` avant d'ecouter, c'est arriver trop tard.
 */
const open = (auth: Record<string, unknown>): ClientSocket =>
  io(url, { transports: ['websocket'], auth, forceNew: true });

/** Ouvre une socket et attend qu'elle soit connectee. */
const connect = (auth: Record<string, unknown>): Promise<ClientSocket> =>
  new Promise((resolve) => {
    const socket = open(auth);
    socket.on('connect', () => {
      resolve(socket);
    });
  });

/** Ouvre une socket et attend le refus du serveur. */
const expectRefusal = (auth: Record<string, unknown>): Promise<{ code: string } | null> =>
  new Promise((resolve) => {
    const socket = open(auth);
    const timer = setTimeout(() => {
      socket.disconnect();
      resolve(null);
    }, 2_000);
    socket.on('error', (payload: { code: string }) => {
      clearTimeout(timer);
      socket.disconnect();
      resolve(payload);
    });
  });

/** Attend le premier message d'un type donne, ou rend null au bout du delai. */
const waitFor = <T>(socket: ClientSocket, event: string, timeoutMs = 2_000): Promise<T | null> =>
  new Promise((resolve) => {
    const timer = setTimeout(() => {
      resolve(null);
    }, timeoutMs);
    socket.once(event, (payload: T) => {
      clearTimeout(timer);
      resolve(payload);
    });
  });

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({
    providers: [
      MatchGateway,
      InviteService,
      TimeoutScheduler,
      SystemMatchClock,
      // Mesure de charge eteinte : la passerelle en depend, aucun scenario
      // d'ici ne la lit. `metrics-e2e.test.ts` est celui qui l'allume.
      { provide: MessageMetrics, useFactory: () => new MessageMetrics(false) },
      {
        provide: SocketNotifier,
        useFactory: (logger: PinoLoggerService, m: MessageMetrics) => new SocketNotifier(logger, m),
        inject: [PinoLoggerService, MessageMetrics],
      },
      {
        provide: MatchRuntime,
        inject: [SocketNotifier, TimeoutScheduler, SystemMatchClock],
        useFactory: (
          notifier: SocketNotifier,
          scheduler: TimeoutScheduler,
          clock: SystemMatchClock,
        ) => new MatchRuntime(notifier, scheduler, clock),
      },
      {
        provide: SocketAuthenticator,
        useValue: new SocketAuthenticator({
          verify: (token: string) =>
            token === 'jwt.bon'
              ? Promise.resolve({ sub: 'p_1' })
              : Promise.reject(new Error('non')),
        }),
      },
      /**
       * Annuaire vide : aucun nom connu.
       *
       * Ce fichier teste la poignee de main et l'authentification, pas les
       * noms — et un annuaire muet couvre au passage le repli sur
       * `UNKNOWN_PLAYER_NAME`, qui est le cas reel d'un compte efface.
       */
      {
        // Personne ne porte rien de particulier : chacun aura l'effet offert
        // de son palier, comme tout le monde avant la boutique.
        provide: PLAYER_WARDROBE,
        useValue: { wearingOf: () => Promise.resolve({ ownedEffects: [], dances: {} }) },
      },
      {
        provide: PLAYER_DIRECTORY,
        useValue: { displayNames: () => Promise.resolve(new Map<string, string>()) },
      },
      {
        provide: PinoLoggerService,
        useValue: new PinoLoggerService(createLogger(config)),
      },
      // File d'attente en memoire : la passerelle la recoit, ce fichier ne
      // l'exerce pas (voir `queue-e2e.test.ts`).
      ...matchmakingTestProviders(),
    ],
  }).compile();

  // Fastify explicitement : `createNestApplication()` sans adaptateur reclame
  // @nestjs/platform-express, que ce projet n'installe pas.
  app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
  app.useWebSocketAdapter(new IoAdapter(app));
  await app.init();
  await app.listen(0, '127.0.0.1');
  url = (await app.getUrl()).replace('[::1]', '127.0.0.1');
});

afterAll(async () => {
  await app?.close();
});

describe('handshake — premier filtre', () => {
  it('accepte un jeton valide et une version compatible', async () => {
    const socket = await connect({ token: 'jwt.bon', protocolVersion: PROTOCOL_VERSION });
    expect(socket.connected).toBe(true);
    socket.disconnect();
  });

  it('refuse un jeton invalide et coupe la socket', async () => {
    const error = await expectRefusal({ token: 'jwt.faux', protocolVersion: PROTOCOL_VERSION });
    expect(error?.code).toBe('UNAUTHORIZED');
  });

  it('dit a un client perime de se mettre a jour', async () => {
    const error = await expectRefusal({ token: 'jwt.bon', protocolVersion: '2.0.0' });
    expect(error?.code).toBe('CLIENT_OUTDATED');
  });

  it('refuse un handshake sans jeton', async () => {
    const error = await expectRefusal({});
    expect(error?.code).toBe('INVALID_PAYLOAD');
  });
});

describe('ping — synchronisation d horloge', () => {
  it('renvoie l instant du client et l heure serveur', async () => {
    const socket = await connect({ token: 'jwt.bon', protocolVersion: PROTOCOL_VERSION });
    socket.emit('ping', { t: 1234.5 });
    const pong = await waitFor<{ t: number; serverTime: number }>(socket, 'pong');
    expect(pong?.t).toBe(1234.5);
    expect(pong?.serverTime).toBeGreaterThan(1_700_000_000_000);
    socket.disconnect();
  });
});

describe('validation — troisieme filtre', () => {
  it('refuse une charge utile qui ne suit pas son schema', async () => {
    const socket = await connect({ token: 'jwt.bon', protocolVersion: PROTOCOL_VERSION });
    socket.emit('ping', { t: 'pas un nombre' });
    const error = await waitFor<{ code: string }>(socket, 'error');
    expect(error?.code).toBe('INVALID_PAYLOAD');
    socket.disconnect();
  });

  it('refuse un evenement inconnu du registre', async () => {
    const socket = await connect({ token: 'jwt.bon', protocolVersion: PROTOCOL_VERSION });
    socket.emit('admin:giveMeEnergy', { amount: 999 });
    const error = await waitFor<{ code: string }>(socket, 'error');
    expect(error?.code).toBe('INVALID_PAYLOAD');
    socket.disconnect();
  });

  it('n accepte aucun score calcule par le client', async () => {
    const socket = await connect({ token: 'jwt.bon', protocolVersion: PROTOCOL_VERSION });
    socket.emit('choice:lock', {
      matchId: 'm_01',
      round: 1,
      seq: 1,
      move: { style: 'calme', tier: 2 },
      amp: 0,
      ult: false,
      timing: { chargeAt: 0, tapAt: 500 },
      score: 999,
    });
    const error = await waitFor<{ code: string }>(socket, 'error');
    expect(error?.code).toBe('INVALID_PAYLOAD');
    socket.disconnect();
  });
});

describe('debit — deuxieme filtre', () => {
  it('coupe un client qui inonde la socket', async () => {
    const socket = await connect({ token: 'jwt.bon', protocolVersion: PROTOCOL_VERSION });
    for (let i = 0; i < 60; i += 1) {
      socket.emit('ping', { t: i });
    }
    const error = await waitFor<{ code: string }>(socket, 'error');
    expect(error?.code).toBe('RATE_LIMITED');
    socket.disconnect();
  });

  it('laisse passer un rythme de jeu normal', async () => {
    const socket = await connect({ token: 'jwt.bon', protocolVersion: PROTOCOL_VERSION });
    let refus = 0;
    socket.on('error', () => {
      refus += 1;
    });
    for (let i = 0; i < 10; i += 1) {
      socket.emit('ping', { t: i });
    }
    await waitFor(socket, 'pong');
    expect(refus).toBe(0);
    socket.disconnect();
  });
});
