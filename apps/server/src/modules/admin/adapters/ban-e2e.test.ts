import { BALANCE, type BalanceConfig } from '@aura/rules';
import { PROTOCOL_VERSION, type ServerMessage } from '@aura/protocol';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { IoAdapter } from '@nestjs/platform-socket.io';
import { Test } from '@nestjs/testing';
import { io, type Socket as ClientSocket } from 'socket.io-client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { AdminAuditEntry } from '../../../shared/admin-audit.js';
import { CONFIG, loadConfig } from '../../../shared/config.js';
import { createLogger, PinoLoggerService } from '../../../shared/logger.js';
import { MessageMetrics } from '../../../shared/metrics.js';
import { AuthController } from '../../auth/adapters/auth.controller.js';
import { PlayerBanEvents } from '../../auth/application/ban-events.js';
import { EmailAuthService } from '../../auth/application/email.js';
import { FreshAccessTokenVerifier } from '../../auth/application/fresh-token.js';
import { IpRateLimit } from '../../auth/application/ip-rate-limit.js';
import { ProfileService } from '../../auth/application/profile.js';
import { RecoveryService } from '../../auth/application/recovery.js';
import { SessionService } from '../../auth/application/session.js';
import { SocketAuthenticator } from '../../auth/application/socket-auth.js';
import { hashSecret } from '../../auth/domain/credentials.js';
import type { RefreshTokenRecord } from '../../auth/domain/ports.js';
import { FeatureFlags } from '../../flags/application/feature-flags.js';
import { enforceBans } from '../../match/application/ban-enforcement.js';
import { InviteService } from '../../match/application/invites.js';
import { MatchRuntime } from '../../match/application/match-runtime.js';
import { matchmakingTestProviders } from '../../match/application/testing-wiring.js';
import { MatchGateway } from '../../match/adapters/match.gateway.js';
import { SocketNotifier } from '../../match/adapters/socket-notifier.js';
import { SystemMatchClock, TimeoutScheduler } from '../../match/adapters/timeout-scheduler.js';
import { PLAYER_DIRECTORY } from '../../match/domain/directory.js';
import { PLAYER_WARDROBE } from '../../match/domain/wardrobe.js';
import { RuleEventsService } from '../../rule-events/application/rule-events.service.js';
import { AdminGate } from '../application/admin-gate.js';
import { AdminPlayersService } from '../application/admin-players.service.js';
import {
  ADMIN_AUDIT_READER,
  type AdminPlayerDetailRow,
  type AdminPlayerStore,
  type StoredBan,
} from '../domain/ports.js';
import { AdminGuard } from './admin.guard.js';
import { AdminManageController } from './admin-manage.controller.js';

/**
 * Bannissement de bout en bout (ADR 0018), deux clients Socket.IO.
 *
 * Un seul registre de joueurs en memoire tient le bannissement : le panneau
 * l'ecrit, le verificateur partage et la session le lisent — exactement comme
 * les trois lisent la meme ligne `Player` en production. Le match, la
 * passerelle, la garde du panneau, le verificateur et la session sont les
 * vrais.
 */
const FAST: BalanceConfig = {
  ...BALANCE,
  phases: { introMs: 200, rechargeMs: 2_000, choiceMs: 5_000, revealMs: 20 },
};
const SECRET = 'secret-d-administration-assez-long';
const serverConfig = loadConfig({
  DATABASE_URL: 'postgresql://inutilise',
  REDIS_URL: 'redis://inutilise',
  JWT_SECRET: 'un-secret-assez-long',
  NODE_ENV: 'test',
  ADMIN_TOKEN: SECRET,
});

const HOST = 'ban_host';
const GUEST = 'ban_guest';
const REFRESH = `refresh-${'r'.repeat(60)}`;

/** Le registre des joueurs, partage : c'est la ligne `Player` de ce scenario. */
class Registry implements AdminPlayerStore {
  readonly rows = new Map<string, AdminPlayerDetailRow>();
  readonly journal: AdminAuditEntry[] = [];

  add(id: string): void {
    this.rows.set(id, {
      id,
      displayName: `Aura ${id}`,
      createdAt: new Date(0),
      lastSeenAt: new Date(0),
      ban: null,
      xp: 0,
      softCurrency: 0,
      hardCurrency: 0,
      league: null,
      recentMatches: [],
    });
  }
  banOf(id: string): StoredBan | null {
    return this.rows.get(id)?.ban ?? null;
  }
  search() {
    return Promise.resolve([...this.rows.values()]);
  }
  detail(id: string) {
    return Promise.resolve(this.rows.get(id) ?? null);
  }
  setBan(id: string, ban: StoredBan | null, audit: (before: StoredBan | null) => AdminAuditEntry) {
    const row = this.rows.get(id);
    if (row === undefined) return Promise.resolve(false);
    this.journal.push(audit(row.ban));
    this.rows.set(id, { ...row, ban });
    return Promise.resolve(true);
  }
}

const registry = new Registry();
registry.add(HOST);
registry.add(GUEST);

/** Un jeton de rafraichissement vivant pour l'hote, jamais consomme par un refus. */
const refreshRow = (): RefreshTokenRecord => ({
  id: 'rt_host',
  playerId: HOST,
  tokenHash: hashSecret(REFRESH),
  createdAt: new Date(0),
  expiresAt: new Date(Date.now() + 3_600_000),
  credentialsVersion: 0,
  revokedAt: null,
  replacedBy: null,
});

const sessions = new SessionService({
  players: {
    findById: (id: string) =>
      Promise.resolve(
        registry.rows.has(id) ? { id, displayName: `Aura ${id}`, ban: registry.banOf(id) } : null,
      ),
  } as never,
  refreshTokens: {
    findByHash: (hash: string) =>
      Promise.resolve(hash === hashSecret(REFRESH) ? refreshRow() : null),
    rotate: () => Promise.resolve({ outcome: 'ROTATED', credentialsVersion: 0 }),
    revokeAllForPlayer: () => Promise.resolve(),
  } as never,
  signer: { sign: ({ playerId }) => Promise.resolve(`jwt.${playerId}`) },
  clock: { now: () => new Date() },
  accessTtlSeconds: 900,
  refreshTtlSeconds: 3_600,
});

/** Le verificateur partage, sur le meme registre : version 0, bannissement lu. */
const verifier = new FreshAccessTokenVerifier(
  {
    verify: (token: string) =>
      token.startsWith('jwt.') && token.length > 4
        ? Promise.resolve({ sub: token.slice(4) })
        : Promise.reject(new Error('jeton invalide')),
  },
  {
    credentialsVersion: () => Promise.resolve(0),
    accessStateOf: (id: string) =>
      Promise.resolve(
        registry.rows.has(id) ? { credentialsVersion: 0, ban: registry.banOf(id) } : null,
      ),
  },
  { now: () => new Date() },
);

let app: NestFastifyApplication;
let url: string;

/** Tout ce qu'une socket recoit, enregistre AVANT la connexion. */
class Recorder {
  readonly received: { name: string; payload: unknown }[] = [];
  readonly socket: ClientSocket;
  disconnected = false;

  constructor(token: string) {
    this.socket = io(url, {
      transports: ['websocket'],
      auth: { token, protocolVersion: PROTOCOL_VERSION },
      forceNew: true,
      reconnection: false,
    });
    this.socket.onAny((name: string, payload: unknown) => {
      this.received.push({ name, payload });
    });
    this.socket.on('disconnect', () => {
      this.disconnected = true;
    });
  }

  async first<T>(name: string, timeoutMs = 6_000): Promise<T> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const found = this.received.find((message) => message.name === name);
      if (found !== undefined) return found.payload as T;
      if (Date.now() > deadline) {
        throw new Error(
          `« ${name} » jamais recu (recus : ${this.received.map((m) => m.name).join(', ')})`,
        );
      }
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
  }

  async untilDisconnected(timeoutMs = 3_000): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (!this.disconnected) {
      if (Date.now() > deadline) throw new Error('la socket est restee ouverte');
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
  }
}

/** Le joueur a bannir pendant sa prochaine connexion (course du relecteur). */
let banDuringConnection: string | null = null;

const admin = (method: 'POST', path: string, payload: Record<string, unknown>) =>
  app.inject({ method, url: path, payload, headers: { authorization: `Bearer ${SECRET}` } });

const refresh = () =>
  app.inject({ method: 'POST', url: '/auth/refresh', payload: { refreshToken: REFRESH } });

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({
    controllers: [AdminManageController, AuthController],
    providers: [
      MatchGateway,
      InviteService,
      TimeoutScheduler,
      SystemMatchClock,
      { provide: MessageMetrics, useFactory: () => new MessageMetrics(false) },
      { provide: PinoLoggerService, useValue: new PinoLoggerService(createLogger(serverConfig)) },
      { provide: SocketAuthenticator, useValue: new SocketAuthenticator(verifier) },
      {
        provide: PLAYER_WARDROBE,
        useValue: {
          // Un bannissement peut tomber PENDANT les lectures de la connexion,
          // entre la verification du jeton et l'enregistrement de la socket.
          wearingOf: async (playerId: string) => {
            if (playerId === banDuringConnection) {
              banDuringConnection = null;
              await admin('POST', `/admin/players/${playerId}/ban`, {
                until: null,
                reason: 'banni pendant la connexion',
              });
            }
            return { ownedEffects: [], owned: [], look: {} };
          },
        },
      },
      {
        provide: PLAYER_DIRECTORY,
        useValue: {
          displayNames: (ids: readonly string[]) =>
            Promise.resolve(new Map(ids.map((id) => [id, `Aura ${id}`]))),
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
        useFactory: (n: SocketNotifier, s: TimeoutScheduler, c: SystemMatchClock) =>
          new MatchRuntime(n, s, c, FAST),
      },
      ...matchmakingTestProviders(),

      // Le panneau, avec sa vraie garde.
      { provide: CONFIG, useValue: serverConfig },
      {
        provide: AdminGate,
        useValue: new AdminGate({ token: () => SECRET, now: () => Date.now() }),
      },
      AdminGuard,
      PlayerBanEvents,
      {
        provide: AdminPlayersService,
        inject: [PlayerBanEvents],
        useFactory: (bans: PlayerBanEvents) =>
          new AdminPlayersService({ store: registry, clock: { now: () => Date.now() }, bans }),
      },
      {
        provide: 'BAN_ENFORCEMENT',
        inject: [PlayerBanEvents, MatchRuntime, SocketNotifier],
        useFactory: (bans: PlayerBanEvents, runtime: MatchRuntime, notifier: SocketNotifier) => {
          enforceBans(bans, runtime, notifier);
          return true;
        },
      },
      {
        provide: FeatureFlags,
        useValue: new FeatureFlags({ rollouts: { intentBubble: 0 }, clock: { now: Date.now } }),
      },
      {
        provide: RuleEventsService,
        useValue: new RuleEventsService({
          store: {
            loadFrom: () => Promise.resolve(new Map()),
            setOverride: () => Promise.resolve(),
          },
          clock: { now: Date.now },
        }),
      },
      { provide: ADMIN_AUDIT_READER, useValue: { latest: () => Promise.resolve([]) } },

      // La session, avec le vrai service de session.
      { provide: SessionService, useValue: sessions },
      { provide: EmailAuthService, useValue: {} },
      { provide: ProfileService, useValue: {} },
      { provide: RecoveryService, useValue: {} },
      { provide: IpRateLimit, useValue: { allow: () => Promise.resolve('ALLOWED') } },
      { provide: 'ACCESS_TOKEN_VERIFIER', useValue: verifier },
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

describe('bannir depuis le panneau, de bout en bout', () => {
  it('forfait du match en cours, socket fermee, handshake et rafraichissement refuses, puis levee', async () => {
    // Deux joueurs face a face, par invitation.
    const host = new Recorder(`jwt.${HOST}`);
    const guest = new Recorder(`jwt.${GUEST}`);
    await new Promise((resolve) => setTimeout(resolve, 100));
    host.socket.emit('invite:create');
    const invite = await host.first<ServerMessage<'invite:created'>>('invite:created');
    guest.socket.emit('invite:join', { code: invite.code });
    const found = await guest.first<ServerMessage<'match:found'>>('match:found');
    await guest.first<ServerMessage<'round:intro'>>('round:intro');
    expect((await refresh()).statusCode).toBe(201);

    // Le panneau bannit l'hote.
    const banned = await admin('POST', `/admin/players/${HOST}/ban`, {
      until: null,
      reason: 'triche avérée',
    });
    expect(banned.statusCode).toBe(200);
    expect(registry.journal.at(-1)).toMatchObject({ action: 'player.ban', target: HOST });

    // Son adversaire gagne par forfait, sur-le-champ — pas au bout de 45 s.
    const end = await guest.first<ServerMessage<'match:end'>>('match:end', 2_000);
    expect(end.reason).toBe('forfeit');
    expect(end.winner).toBe(found.seat);
    // Et la socket du banni est fermee.
    await host.untilDisconnected();

    // Il ne revient pas : refus au handshake, non reessayable, puis deconnexion.
    const back = new Recorder(`jwt.${HOST}`);
    const refused = await back.first<ServerMessage<'error'>>('error');
    expect(refused).toEqual({ code: 'BANNED', message: 'compte suspendu', retryable: false });
    await back.untilDisconnected();
    // Ni par rafraichissement de session.
    const denied = await refresh();
    expect(denied.statusCode).toBe(403);
    expect(denied.json<{ code: string }>().code).toBe('BANNED');

    // Levee : tout revient.
    const lifted = await admin('POST', `/admin/players/${HOST}/unban`, {
      reason: 'erreur de ma part',
    });
    expect(lifted.statusCode).toBe(200);
    expect((await refresh()).statusCode).toBe(201);
    const again = new Recorder(`jwt.${HOST}`);
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(again.socket.connected).toBe(true);
    expect(again.received.filter((message) => message.name === 'error')).toEqual([]);

    for (const recorder of [guest, again]) recorder.socket.disconnect();
  });

  /*
    Relecture de securite : un bannissement qui tombe entre la verification du
    jeton et l'enregistrement de la socket ne trouvait aucune socket a fermer —
    et la socket, enregistree juste apres, n'etait jamais reverifiee. Le banni
    restait connecte jusqu'a son depart.
  */
  it('ferme aussi la socket d un joueur banni pendant sa connexion', async () => {
    banDuringConnection = GUEST;
    const late = new Recorder(`jwt.${GUEST}`);
    await late.untilDisconnected();
    await admin('POST', `/admin/players/${GUEST}/unban`, { reason: 'fin du test' });
  });
});
