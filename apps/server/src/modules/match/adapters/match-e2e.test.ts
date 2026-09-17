import { PROTOCOL_VERSION, type ServerMessage } from '@aura/protocol';
import { BALANCE, type BalanceConfig } from '@aura/rules';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { IoAdapter } from '@nestjs/platform-socket.io';
import { Test } from '@nestjs/testing';
import { io, type Socket as ClientSocket } from 'socket.io-client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadConfig } from '../../../shared/config.js';
import { createLogger, PinoLoggerService } from '../../../shared/logger.js';
import { SocketAuthenticator } from '../../auth/application/socket-auth.js';
import { InviteService } from '../application/invites.js';
import { MatchRuntime } from '../application/match-runtime.js';
import { MatchGateway } from './match.gateway.js';
import { SocketNotifier } from './socket-notifier.js';
import { SystemMatchClock, TimeoutScheduler } from './timeout-scheduler.js';

/**
 * Scenario de bout en bout : deux clients Socket.IO jouent un match complet.
 *
 * C'est le critere d'acceptation du jalon M3. Les phases sont raccourcies par
 * configuration — le moteur prend ses durees en parametre — pour qu'un match
 * entier tienne en une seconde au lieu de vingt-cinq par manche.
 */

/**
 * Meme jeu, horloge acceleree.
 *
 * Intro, recharge et revelation sont reduites a presque rien : rien ne s'y
 * passe cote test. La phase de choix reste longue, elle, parce que c'est la
 * seule ou le test doit agir — la raccourcir ferait expirer la manche avant
 * que le client n'ait verrouille, et on testerait l'echeance au lieu du jeu.
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

/**
 * Jeton porteur : `jwt.<identifiant>`.
 *
 * Chaque scenario doit utiliser des joueurs **distincts**. Le notifier indexe
 * les sockets par identifiant de joueur, et une nouvelle socket remplace
 * l'ancienne — c'est le comportement voulu pour une reconnexion, mais deux
 * tests qui partagent une identite se volent leurs messages.
 */
const subjectOf = (token: string): string | null =>
  token.startsWith('jwt.') && token.length > 4 ? token.slice(4) : null;

let playerCounter = 0;
const nextPlayerId = (): string => `p_${String((playerCounter += 1))}`;

let app: NestFastifyApplication;
let url: string;

/** Ouvre une socket et attend sa connexion. */
const connect = (token: string): Promise<ClientSocket> =>
  new Promise((resolve) => {
    const socket = io(url, {
      transports: ['websocket'],
      auth: { token, protocolVersion: PROTOCOL_VERSION },
      forceNew: true,
    });
    socket.on('connect', () => {
      resolve(socket);
    });
  });

/**
 * Enregistre **tout** ce qu'une socket recoit, des sa connexion.
 *
 * Un match avance en quelques dizaines de millisecondes : poser un ecouteur au
 * moment ou l'on s'interesse a un message arrive systematiquement trop tard.
 * On capture donc depuis le debut et on interroge le journal ensuite.
 */
class Recorder {
  readonly received: { name: string; payload: unknown }[] = [];
  private readonly waiters: (() => void)[] = [];

  constructor(readonly socket: ClientSocket) {
    socket.onAny((name: string, payload: unknown) => {
      this.received.push({ name, payload });
      for (const wake of this.waiters.splice(0)) wake();
    });
  }

  /** Messages deja recus portant ce nom. */
  all<T>(name: string): T[] {
    return this.received.filter((m) => m.name === name).map((m) => m.payload as T);
  }

  /** Attend le n-ieme message de ce nom (1 = le premier), deja recu ou non. */
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
      await new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, 25);
        this.waiters.push(() => {
          clearTimeout(timer);
          resolve();
        });
      });
    }
  }

  /** Premier message de ce nom. */
  first<T>(name: string, timeoutMs = 6_000): Promise<T> {
    return this.nth<T>(name, 1, timeoutMs);
  }
}

/** Ouvre une socket enregistree des la connexion, pour un joueur neuf. */
const record = async (playerId: string = nextPlayerId()): Promise<Recorder> =>
  new Recorder(await connect(`jwt.${playerId}`));

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({
    providers: [
      MatchGateway,
      InviteService,
      TimeoutScheduler,
      SystemMatchClock,
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
        provide: SocketNotifier,
        inject: [PinoLoggerService],
        useFactory: (logger: PinoLoggerService) => new SocketNotifier(logger),
      },
      {
        provide: MatchRuntime,
        inject: [SocketNotifier, TimeoutScheduler, SystemMatchClock],
        useFactory: (
          notifier: SocketNotifier,
          scheduler: TimeoutScheduler,
          clock: SystemMatchClock,
        ) => new MatchRuntime(notifier, scheduler, clock, FAST),
      },
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

/** Met deux joueurs face a face par invitation, sockets deja enregistrees. */
async function seatTwoPlayers(): Promise<{
  host: Recorder;
  guest: Recorder;
  matchId: string;
}> {
  const host = await record();
  const guest = await record();

  host.socket.emit('invite:create');
  const invite = await host.first<ServerMessage<'invite:created'>>('invite:created');
  guest.socket.emit('invite:join', { code: invite.code });

  const found = await host.first<ServerMessage<'match:found'>>('match:found');
  await guest.first<ServerMessage<'match:found'>>('match:found');
  return { host, guest, matchId: found.matchId };
}

/** Ferme proprement deux sockets. */
const close = (...recorders: Recorder[]): void => {
  for (const r of recorders) r.socket.disconnect();
};

/** Verrouille un choix simple pour un joueur. */
const lock = (player: Recorder, matchId: string, round: number, tier: 0 | 1 | 2 | 3 | 4): void => {
  player.socket.emit('choice:lock', {
    matchId,
    round,
    seq: round,
    move: { style: 'calme', tier },
    amp: 0,
    ult: false,
    timing: { chargeAt: 0, tapAt: 400 },
  });
};

describe('invitation — se retrouver a deux sans passer par la file', () => {
  it('ouvre un match et assoit les deux joueurs a des places differentes', async () => {
    const host = await record();
    const guest = await record();

    host.socket.emit('invite:create');
    const invite = await host.first<ServerMessage<'invite:created'>>('invite:created');
    expect(invite.code).toMatch(/^[A-Z0-9]{6}$/);
    expect(invite.deepLink).toContain(invite.code);

    guest.socket.emit('invite:join', { code: invite.code });
    const cote1 = await host.first<ServerMessage<'match:found'>>('match:found');
    const cote2 = await guest.first<ServerMessage<'match:found'>>('match:found');

    expect(cote1.matchId).toBe(cote2.matchId);
    expect(cote1.seat).not.toBe(cote2.seat);
    expect(cote1.protocolVersion).toBe(PROTOCOL_VERSION);

    close(host, guest);
  });

  it('refuse un code inconnu', async () => {
    const guest = await record();
    guest.socket.emit('invite:join', { code: 'ZZZZZZ' });
    const error = await guest.first<{ code: string }>('error');
    expect(error.code).toBe('INVITE_NOT_FOUND');
    close(guest);
  });
});

describe('manche complete', () => {
  it('enchaine intro, recharge et choix, dans cet ordre', async () => {
    const { host, guest } = await seatTwoPlayers();
    await host.first<ServerMessage<'choice:start'>>('choice:start');

    const ordre = host.received.map((m) => m.name);
    expect(ordre.indexOf('round:intro')).toBeLessThan(ordre.indexOf('recharge:start'));
    expect(ordre.indexOf('recharge:start')).toBeLessThan(ordre.indexOf('choice:start'));

    const intro = await host.first<ServerMessage<'round:intro'>>('round:intro');
    expect(intro.round).toBe(1);
    expect(intro.energy).toBe(BALANCE.match.startingEnergy);

    const recharge = await host.first<ServerMessage<'recharge:start'>>('recharge:start');
    expect(recharge.orbs.length).toBeGreaterThan(0);
    expect(recharge.endsAt).toBeGreaterThan(recharge.startsAt);

    close(host, guest);
  });

  it('donne exactement les memes orbes aux deux joueurs', async () => {
    const { host, guest } = await seatTwoPlayers();
    const pourHote = await host.first<ServerMessage<'recharge:start'>>('recharge:start');
    const pourInvite = await guest.first<ServerMessage<'recharge:start'>>('recharge:start');
    expect(pourHote.orbs).toEqual(pourInvite.orbs);
    close(host, guest);
  });

  it('revele les deux choix quand les deux ont verrouille', async () => {
    const { host, guest, matchId } = await seatTwoPlayers();
    await host.first('choice:start');

    lock(host, matchId, 1, 3);
    lock(guest, matchId, 1, 0);

    const vuHote = await host.first<ServerMessage<'round:result'>>('round:result');
    const vuInvite = await guest.first<ServerMessage<'round:result'>>('round:result');

    expect(vuHote).toEqual(vuInvite);
    expect(vuHote.sides.a.move.tier).toBe(3);
    expect(vuHote.sides.b.move.tier).toBe(0);
    expect(vuHote.winner).toBe('a');
    expect(vuHote.round).toBe(1);

    close(host, guest);
  });

  it('previent l adversaire du verrouillage sans rien lui reveler', async () => {
    const { host, guest, matchId } = await seatTwoPlayers();
    await host.first('choice:start');

    host.socket.emit('choice:lock', {
      matchId,
      round: 1,
      seq: 1,
      move: { style: 'provoc', tier: 4 },
      amp: 4,
      ult: false,
      timing: { chargeAt: 0, tapAt: 400 },
    });

    const vu = await guest.first<ServerMessage<'opponent:locked'>>('opponent:locked');
    expect(vu).toEqual({ matchId, round: 1 });
    // Ni mouvement, ni amplificateur, ni timing.
    expect(JSON.stringify(vu)).not.toContain('provoc');
    // Et rien d'autre n'est arrive entre-temps qui le trahirait.
    expect(guest.received.map((m) => m.name)).not.toContain('round:result');

    close(host, guest);
  });

  it('resout la manche a l echeance quand personne ne verrouille', async () => {
    const { host, guest } = await seatTwoPlayers();
    const result = await host.first<ServerMessage<'round:result'>>('round:result');
    // Action par defaut : palier 0, timing rate (docs/01 §9).
    expect(result.sides.a.move.tier).toBe(0);
    expect(result.sides.a.timing.quality).toBe('miss');
    close(host, guest);
  });
});

describe('match complet', () => {
  it('va jusqu a la victoire en deux manches', async () => {
    const { host, guest, matchId } = await seatTwoPlayers();

    for (let round = 1; round <= 2; round += 1) {
      await host.nth('choice:start', round);
      lock(host, matchId, round, 3);
      lock(guest, matchId, round, 0);
      await host.nth('round:result', round);
    }

    const fin = await host.first<ServerMessage<'match:end'>>('match:end');
    expect(fin.winner).toBe('a');
    expect(fin.reason).toBe('rounds');

    // Les deux joueurs apprennent la fin.
    const vuInvite = await guest.first<ServerMessage<'match:end'>>('match:end');
    expect(vuInvite.winner).toBe('a');

    close(host, guest);
  });

  it('donne la victoire a l autre sur abandon', async () => {
    const { host, guest, matchId } = await seatTwoPlayers();
    host.socket.emit('match:forfeit', { matchId });
    const fin = await guest.first<ServerMessage<'match:end'>>('match:end');
    expect(fin.winner).toBe('b');
    expect(fin.reason).toBe('forfeit');
    close(host, guest);
  });
});

describe('securite du match', () => {
  it('refuse une action sur un match ou l on n est pas assis', async () => {
    const intrus = await record();
    intrus.socket.emit('match:forfeit', { matchId: 'm_inexistant' });
    const error = await intrus.first<{ code: string }>('error');
    expect(error.code).toBe('NOT_IN_MATCH');
    close(intrus);
  });

  it('rend un instantane de reprise sans le choix adverse', async () => {
    const { host, guest, matchId } = await seatTwoPlayers();
    await host.first('choice:start');

    guest.socket.emit('choice:lock', {
      matchId,
      round: 1,
      seq: 1,
      move: { style: 'hype', tier: 4 },
      amp: 3,
      ult: false,
      timing: { chargeAt: 0, tapAt: 400 },
    });
    await host.first('opponent:locked');

    host.socket.emit('match:rejoin', { matchId });
    const snapshot = await host.first<ServerMessage<'match:state'>>('match:state');

    expect(snapshot.opponentLocked).toBe(true);
    expect(snapshot.seat).toBe('a');
    // Le choix de l'adversaire n'apparait nulle part dans l'instantane.
    expect(JSON.stringify(snapshot)).not.toContain('hype');

    close(host, guest);
  });

  it('refuse un choix trop cher et ne le dit qu au seul interesse', async () => {
    const { host, guest, matchId } = await seatTwoPlayers();
    await host.first('choice:start');

    // Premier verrouillage accepte, second refuse : un seul par manche.
    lock(host, matchId, 1, 2);
    host.socket.emit('choice:lock', {
      matchId,
      round: 1,
      seq: 2,
      move: { style: 'calme', tier: 1 },
      amp: 0,
      ult: false,
      timing: { chargeAt: 0, tapAt: 400 },
    });

    const error = await host.first<{ code: string }>('error');
    expect(error.code).toBe('ALREADY_LOCKED');
    expect(guest.received.map((m) => m.name)).not.toContain('error');

    close(host, guest);
  });
});

describe('deconnexion et reprise', () => {
  it('ne coupe pas le match quand un joueur se deconnecte', async () => {
    const { host, guest, matchId } = await seatTwoPlayers();
    await host.first('choice:start');

    guest.socket.disconnect();
    // L'hote peut continuer a jouer : le match ne s'arrete pas parce que
    // quelqu'un passe sous un tunnel.
    lock(host, matchId, 1, 2);
    const result = await host.first<ServerMessage<'round:result'>>('round:result');
    expect(result.sides.a.move.tier).toBe(2);
    expect(host.received.map((m) => m.name)).not.toContain('match:end');

    close(host);
  });
});
