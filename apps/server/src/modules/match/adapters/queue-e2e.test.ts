import { PROTOCOL_VERSION, type ServerMessage } from '@aura/protocol';
import { BALANCE, type BalanceConfig } from '@aura/rules';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { IoAdapter } from '@nestjs/platform-socket.io';
import { Test } from '@nestjs/testing';
import { io, type Socket as ClientSocket } from 'socket.io-client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadConfig } from '../../../shared/config.js';
import { createLogger, PinoLoggerService } from '../../../shared/logger.js';
import { MessageMetrics } from '../../../shared/metrics.js';
import { SocketAuthenticator } from '../../auth/application/socket-auth.js';
import { QUEUE_TICK_MS } from '../../matchmaking/application/queue.service.js';
import { InviteService } from '../application/invites.js';
import { MatchRuntime } from '../application/match-runtime.js';
import { matchmakingTestProviders } from '../application/testing-wiring.js';
import { PLAYER_DIRECTORY } from '../domain/directory.js';
import { MatchGateway } from './match.gateway.js';
import { SocketNotifier } from './socket-notifier.js';
import { SystemMatchClock, TimeoutScheduler } from './timeout-scheduler.js';

/**
 * File d'attente, de bout en bout : deux clients Socket.IO reels (jalon M5).
 *
 * C'est le critere d'acceptation de la ligne « file Redis, worker
 * d'appariement, fenetre MMR, `queue:status` ». Le worker tourne ici pour de
 * vrai, a sa cadence de 500 ms ; seuls la file — en memoire au lieu de Redis —
 * et le classement — personne n'est classe — sont substitues.
 *
 * Les scenarios qui comptent ne sont pas les heureux : un ticket qui survit a
 * son joueur fait apparier un absent, et un `queue:join` renvoye en boucle ne
 * doit pas multiplier les chances d'etre apparie.
 */

/** Meme jeu, horloge acceleree : rien ici ne depend de la duree d'une manche. */
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

/**
 * Chaque scenario utilise des joueurs **distincts**.
 *
 * Le notifier indexe les sockets par joueur et une nouvelle socket remplace
 * l'ancienne — c'est voulu pour une reconnexion, mais deux tests qui partagent
 * une identite se volent leurs messages.
 */
let playerCounter = 0;
const nextPlayerId = (): string => `q_${String((playerCounter += 1))}`;

let app: NestFastifyApplication;
let url: string;

/**
 * Enregistre **tout** ce qu'une socket recoit, des sa connexion.
 *
 * Un appariement se joue en quelques centaines de millisecondes : poser un
 * ecouteur au moment ou l'on s'interesse a un message arrive trop tard.
 */
class Recorder {
  readonly received: { name: string; payload: unknown }[] = [];
  private readonly waiters: (() => void)[] = [];

  constructor(
    readonly socket: ClientSocket,
    readonly playerId: string,
  ) {
    socket.onAny((name: string, payload: unknown) => {
      this.received.push({ name, payload });
      for (const wake of this.waiters.splice(0)) wake();
    });
  }

  all<T>(name: string): T[] {
    return this.received.filter((m) => m.name === name).map((m) => m.payload as T);
  }

  /**
   * Attend un message, avec un delai genereux.
   *
   * Douze secondes pour un appariement qui en demande normalement moins d'une :
   * l'ouvrier tourne toutes les 500 ms et parle a Redis, donc tout ce qui
   * ralentit la machine ralentit l'attente. Un delai serre transforme alors
   * une machine chargee en « invariant casse » — et c'est exactement ce qui
   * s'est produit ici, deux fois, sur un poste occupe a construire des images
   * Docker. Le message d'erreur reste precis (il liste ce qui EST arrive), ce
   * qui distingue « rien n'est venu » de « autre chose est venu ».
   */
  async first<T>(name: string, timeoutMs = 12_000): Promise<T> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const found = this.all<T>(name);
      if (found.length > 0) return found[0]!;
      if (Date.now() > deadline) {
        throw new Error(
          `« ${name} » n'est jamais arrive (recus : ${this.received.map((m) => m.name).join(', ')})`,
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

  /** Attend qu'un message de ce nom **n'arrive pas**. */
  async never(name: string, windowMs: number): Promise<void> {
    await wait(windowMs);
    expect(this.all(name)).toHaveLength(0);
  }
}

const wait = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

/** Ouvre une socket enregistree des la connexion, pour un joueur neuf. */
const record = (playerId: string = nextPlayerId()): Promise<Recorder> =>
  new Promise((resolve) => {
    const socket = io(url, {
      transports: ['websocket'],
      auth: { token: `jwt.${playerId}`, protocolVersion: PROTOCOL_VERSION },
      forceNew: true,
    });
    socket.on('connect', () => {
      resolve(new Recorder(socket, playerId));
    });
  });

const close = (...recorders: Recorder[]): void => {
  for (const r of recorders) r.socket.disconnect();
};

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
        ) => new MatchRuntime(notifier, scheduler, clock, FAST),
      },
      // Le worker tourne : c'est lui qu'on eprouve.
      ...matchmakingTestProviders({ withWorker: true }),
    ],
  }).compile();

  app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
  app.useWebSocketAdapter(new IoAdapter(app));
  // `init` declenche `onModuleInit` : c'est la que le worker demarre.
  await app.init();
  await app.listen(0, '127.0.0.1');
  url = (await app.getUrl()).replace('[::1]', '127.0.0.1');
});

afterAll(async () => {
  await app?.close();
});

describe('file d attente — se retrouver sans code d invitation', () => {
  it('apparie deux joueurs et annonce a chacun le nom de l autre', async () => {
    const un = await record();
    const deux = await record();

    un.socket.emit('queue:join', { mode: 'ranked' });
    deux.socket.emit('queue:join', { mode: 'ranked' });

    const pourUn = await un.first<ServerMessage<'match:found'>>('match:found');
    const pourDeux = await deux.first<ServerMessage<'match:found'>>('match:found');

    expect(pourUn.matchId).toBe(pourDeux.matchId);
    expect(pourUn.seat).not.toBe(pourDeux.seat);
    expect(pourUn.opponent.displayName).toBe(`Joueur ${deux.playerId}`);
    expect(pourDeux.opponent.displayName).toBe(`Joueur ${un.playerId}`);

    close(un, deux);
  });

  /** `match:found` avant la premiere manche, par la file comme par l'invitation. */
  it('annonce le match avant la premiere manche', async () => {
    const un = await record();
    const deux = await record();

    un.socket.emit('queue:join', { mode: 'ranked' });
    deux.socket.emit('queue:join', { mode: 'ranked' });

    await un.first<ServerMessage<'round:intro'>>('round:intro');

    const noms = un.received.map((m) => m.name);
    expect(noms.indexOf('match:found')).toBeLessThan(noms.indexOf('round:intro'));

    close(un, deux);
  });

  it('ne marie pas un joueur classe avec un joueur en partie rapide', async () => {
    const classe = await record();
    const rapide = await record();

    classe.socket.emit('queue:join', { mode: 'ranked' });
    rapide.socket.emit('queue:join', { mode: 'casual' });

    await classe.never('match:found', 3 * QUEUE_TICK_MS);

    close(classe, rapide);
  });
});

describe('queue:status — ce que voit celui qui attend', () => {
  it('annonce l attente des l entree en file, puis a chaque tour', async () => {
    const seul = await record();

    seul.socket.emit('queue:join', { mode: 'casual' });
    const premier = await seul.first<ServerMessage<'queue:status'>>('queue:status');

    expect(premier.mode).toBe('casual');
    expect(premier.elapsedMs).toBe(0);
    expect(premier.searchRange).toBe(50);

    await wait(3 * QUEUE_TICK_MS);
    const statuts = seul.all<ServerMessage<'queue:status'>>('queue:status');

    expect(statuts.length).toBeGreaterThan(1);
    expect(statuts.at(-1)!.elapsedMs).toBeGreaterThan(0);

    close(seul);
  });

  /**
   * Regle d'or n°4 : rien de l'adversaire, rien de la file. Le schema de
   * sortie le garantit deja, ce test verifie qu'on n'a pas invente un champ
   * « position » ou « adversaires en ligne » en cours de route.
   */
  it('ne transporte que le mode, l attente et la fenetre', async () => {
    const seul = await record();
    seul.socket.emit('queue:join', { mode: 'ranked' });

    const statut = await seul.first<ServerMessage<'queue:status'>>('queue:status');
    expect(Object.keys(statut).sort()).toEqual(['elapsedMs', 'mode', 'searchRange']);

    close(seul);
  });
});

describe('sortie de file', () => {
  it('cesse d apparier apres queue:leave', async () => {
    const parti = await record();
    const reste = await record();

    parti.socket.emit('queue:join', { mode: 'ranked' });
    await parti.first('queue:status');
    parti.socket.emit('queue:leave', {});
    // Le message precedent est deja traite quand celui-ci revient.
    await wait(QUEUE_TICK_MS);

    reste.socket.emit('queue:join', { mode: 'ranked' });
    await reste.never('match:found', 3 * QUEUE_TICK_MS);

    close(parti, reste);
  });

  /**
   * Le defaut le plus couteux de la file : apparier un joueur qui n'est plus
   * la. Son adversaire recevrait un `match:found` contre personne, puis un
   * forfait au bout de la periode de grace. Le ticket n'est pas detruit pour
   * autant — il est **gare** (voir le scenario de reconnexion ci-dessous) —
   * mais il a quitte la file, et c'est tout ce qui compte ici.
   */
  it('cesse d apparier apres une deconnexion', async () => {
    const fantome = await record();
    const seul = await record();

    fantome.socket.emit('queue:join', { mode: 'ranked' });
    await fantome.first('queue:status');
    fantome.socket.disconnect();
    await wait(QUEUE_TICK_MS);

    seul.socket.emit('queue:join', { mode: 'ranked' });
    await seul.never('match:found', 3 * QUEUE_TICK_MS);

    close(seul);
  });
});

describe('reconnexion pendant l attente', () => {
  /**
   * Une reconnexion n'est pas une sortie de file.
   *
   * `register` ferme la socket precedente et Socket.IO emet `disconnect`
   * synchroniquement : le handler de l'ancienne socket se declenche au beau
   * milieu d'un retour parfaitement legitime. S'il vidait la file, un joueur
   * qui passe sous un tunnel perdrait sa place — et son anciennete — sans que
   * rien ne le lui dise.
   *
   * C'est le seul scenario de ce fichier qui reutilise volontairement une
   * identite : c'est precisement ce qu'on teste.
   */
  it('garde sa place et son anciennete', async () => {
    const playerId = nextPlayerId();
    const avant = await record(playerId);

    avant.socket.emit('queue:join', { mode: 'ranked' });
    await avant.first<ServerMessage<'queue:status'>>('queue:status');
    await wait(2 * QUEUE_TICK_MS);

    // Meme joueur, nouvelle socket : le serveur ferme la precedente.
    const apres = await record(playerId);
    const repris = await apres.first<ServerMessage<'queue:status'>>('queue:status');

    expect(repris.elapsedMs).toBeGreaterThan(0);

    // Et il est toujours appariable : un adversaire le trouve.
    const adversaire = await record();
    adversaire.socket.emit('queue:join', { mode: 'ranked' });
    await apres.first<ServerMessage<'match:found'>>('match:found');

    close(apres, adversaire);
  });

  /**
   * La vraie coupure : la socket meurt, et le joueur revient plus tard.
   *
   * C'est le cas de tous les jours sur mobile — tunnel, appel entrant, et
   * surtout le passage en arriere-plan, ou `docs/03` demande explicitement au
   * client de **fermer sa socket** et de se reconnecter au retour. Detruire le
   * ticket a ce moment-la punirait le comportement que le protocole prescrit.
   *
   * Le ticket est donc garde de cote — hors de la file, personne ne peut etre
   * apparie contre un absent — puis remis en jeu au retour, avec son
   * anciennete. Ce que voit le joueur : son `queue:status` reprend la ou il
   * s'etait arrete, sans qu'il ait rien a redemander.
   */
  it('retrouve sa place apres une coupure, sans rien redemander', async () => {
    const playerId = nextPlayerId();
    const avant = await record(playerId);

    avant.socket.emit('queue:join', { mode: 'ranked' });
    await avant.first<ServerMessage<'queue:status'>>('queue:status');
    await wait(2 * QUEUE_TICK_MS);

    // Coupure franche, puis quelques tours d'appariement sans lui.
    avant.socket.disconnect();
    await wait(2 * QUEUE_TICK_MS);

    const apres = await record(playerId);
    const repris = await apres.first<ServerMessage<'queue:status'>>('queue:status');

    // L'attente n'a pas ete remise a zero : elle couvre au moins l'absence.
    expect(repris.mode).toBe('ranked');
    expect(repris.elapsedMs).toBeGreaterThanOrEqual(2 * QUEUE_TICK_MS);

    const adversaire = await record();
    adversaire.socket.emit('queue:join', { mode: 'ranked' });
    await apres.first<ServerMessage<'match:found'>>('match:found');

    close(apres, adversaire);
  });

  /**
   * Une sortie volontaire ne se rattrape pas par une reconnexion : le joueur a
   * ferme sa recherche, il ne doit pas la retrouver ouverte en revenant.
   */
  it('ne ressuscite pas une recherche annulee', async () => {
    const playerId = nextPlayerId();
    const avant = await record(playerId);

    avant.socket.emit('queue:join', { mode: 'ranked' });
    await avant.first<ServerMessage<'queue:status'>>('queue:status');
    avant.socket.emit('queue:leave', {});
    await wait(QUEUE_TICK_MS);
    avant.socket.disconnect();

    const apres = await record(playerId);
    await apres.never('queue:status', 3 * QUEUE_TICK_MS);

    close(apres);
  });
});

describe('un joueur qui insiste', () => {
  /** Le protocole borne un message, pas la somme des messages. */
  it('n obtient ni deux tickets ni deux matchs en renvoyant queue:join', async () => {
    const insistant = await record();
    const autre = await record();

    for (let i = 0; i < 5; i += 1) {
      insistant.socket.emit('queue:join', { mode: 'ranked' });
    }
    autre.socket.emit('queue:join', { mode: 'ranked' });

    await insistant.first<ServerMessage<'match:found'>>('match:found');
    await wait(3 * QUEUE_TICK_MS);

    expect(insistant.all('match:found')).toHaveLength(1);
    expect(autre.all('match:found')).toHaveLength(1);

    close(insistant, autre);
  });

  it('est refuse quand il cherche un duel alors qu il en joue un', async () => {
    const un = await record();
    const deux = await record();

    un.socket.emit('queue:join', { mode: 'ranked' });
    deux.socket.emit('queue:join', { mode: 'ranked' });
    await un.first('match:found');

    un.socket.emit('queue:join', { mode: 'ranked' });
    const refus = await un.first<{ code: string }>('error');

    expect(refus.code).toBe('ALREADY_IN_MATCH');
    close(un, deux);
  });
});
