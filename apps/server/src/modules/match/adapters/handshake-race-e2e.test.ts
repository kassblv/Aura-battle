import { PROTOCOL_VERSION } from '@aura/protocol';
import { BALANCE, type BalanceConfig } from '@aura/rules';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { IoAdapter } from '@nestjs/platform-socket.io';
import { Test } from '@nestjs/testing';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { loadConfig } from '../../../shared/config.js';
import { createLogger, PinoLoggerService } from '../../../shared/logger.js';
import { MessageMetrics } from '../../../shared/metrics.js';
import { SocketAuthenticator } from '../../auth/application/socket-auth.js';
import { PLAYER_DIRECTORY } from '../domain/directory.js';
import { InviteService } from '../application/invites.js';
import { MatchRuntime } from '../application/match-runtime.js';
import { matchmakingTestProviders } from '../application/testing-wiring.js';
import { MatchGateway } from './match.gateway.js';
import { SocketNotifier } from './socket-notifier.js';
import { SystemMatchClock, TimeoutScheduler } from './timeout-scheduler.js';

/**
 * La fenetre entre l'ouverture d'une socket et la fin de son authentification.
 *
 * `handleConnection` attend `authenticate` AVANT de poser `socket.data` et
 * AVANT d'installer le filtre `socket.use` qui porte la limite de debit et la
 * validation de schema. NestJS branche les `@SubscribeMessage` pendant que
 * `handleConnection` est encore suspendue.
 *
 * Si un paquet arrive dans cette fenetre, il atteint donc un gestionnaire :
 * sans identite (`playerOf` rend `undefined`), sans limite de debit, et sans
 * schema. Le jeton n'a jamais besoin d'etre valide — la deconnexion arrive
 * apres.
 *
 * Ce test ecrit les deux trames dans le MEME appel a `send`, comme le ferait
 * un client ecrit pour ca. Il n'utilise pas `socket.io-client`, qui attend
 * poliment la reponse de connexion.
 */

const FAST: BalanceConfig = {
  ...BALANCE,
  phases: { introMs: 20, rechargeMs: 3_000, choiceMs: 2_000, revealMs: 20 },
};

/** Duree de l'authentification simulee : largement plus qu'un tour de boucle. */
const AUTH_DELAY_MS = 200;

const serverConfig = loadConfig({
  DATABASE_URL: 'postgresql://inutilise',
  REDIS_URL: 'redis://inutilise',
  JWT_SECRET: 'un-secret-assez-long',
  NODE_ENV: 'test',
});

let app: NestFastifyApplication;
let wsUrl: string;
const metrics = new MessageMetrics(true);

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({
    providers: [
      MatchGateway,
      InviteService,
      TimeoutScheduler,
      SystemMatchClock,
      { provide: MessageMetrics, useValue: metrics },
      {
        provide: PinoLoggerService,
        useValue: new PinoLoggerService(createLogger(serverConfig)),
      },
      {
        provide: SocketAuthenticator,
        useValue: new SocketAuthenticator({
          /**
           * Verification **deliberement lente**, et c'est tout l'interet.
           *
           * La vraie (`verifyAsync` sur un secret HMAC) ne fait aucune
           * entree-sortie : elle se resout dans les microtaches du meme tour,
           * donc la fenetre se referme avant qu'un paquet d'une lecture reseau
           * suivante n'arrive. Le serveur est sauve par un accident
           * d'ordonnancement, pas par une defense.
           *
           * Ce delai simule ce qui arrivera le jour ou la verification
           * consultera une liste de revocation dans Redis ou une base :
           * l'attente traverse plusieurs tours de boucle, `handleConnection`
           * reste suspendue, et les `@SubscribeMessage` sont deja branches.
           * Alors seul le filtre pose en tete protege encore.
           */
          verify: (token: string) =>
            new Promise((resolve, reject) => {
              setTimeout(() => {
                if (token.startsWith('jwt.')) resolve({ sub: token.slice(4) });
                else reject(new Error('jeton invalide'));
              }, AUTH_DELAY_MS);
            }),
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
      ...matchmakingTestProviders(),
    ],
  }).compile();

  app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
  app.useWebSocketAdapter(new IoAdapter(app));
  await app.init();
  await app.listen(0, '127.0.0.1');
  const url = (await app.getUrl()).replace('[::1]', '127.0.0.1');
  wsUrl = `${url.replace('http', 'ws')}/socket.io/?EIO=4&transport=websocket`;
});

afterAll(async () => {
  await app?.close();
});

/**
 * Ouvre une socket brute, puis ecrit la connexion de namespace et un evenement
 * l'un derriere l'autre, sans rien attendre entre les deux.
 *
 * Rend tout ce que le serveur a repondu avant de fermer.
 */
function attack(
  token: string,
  event: unknown,
  payload: unknown,
  delayMs = 0,
  surAccuse = false,
): Promise<readonly string[]> {
  return new Promise((resolve) => {
    // `WebSocket` natif de Node : pas de dependance a ajouter pour un test.
    const socket = new WebSocket(wsUrl);
    const received: string[] = [];
    const done = (): void => {
      clearTimeout(timer);
      if (socket.readyState === WebSocket.OPEN) socket.close();
      resolve(received);
    };
    const timer = setTimeout(done, 1_500);

    socket.addEventListener('close', done);
    socket.addEventListener('error', done);

    socket.addEventListener('message', (frame: MessageEvent) => {
      const text = String(frame.data);
      // `0{...}` : engine.io est ouvert, le namespace peut etre rejoint.
      if (text.startsWith('0{')) {
        socket.send(`40${JSON.stringify({ token, protocolVersion: PROTOCOL_VERSION })}`);
        if (event === null || surAccuse) return;
        const message = `42${JSON.stringify([event, payload])}`;
        // Les deux d'affilee, sans ceder la main : c'est tout le scenario.
        if (delayMs === 0) socket.send(message);
        else
          setTimeout(() => {
            socket.send(message);
          }, delayMs);
        return;
      }
      received.push(text);
      // Variante « au rebond » : l'accuse de connexion arrive, on emet dans le
      // meme tour d'evenement, avant que `handleConnection` ait pu reprendre.
      if (surAccuse && event !== null && text.startsWith('40{')) {
        socket.send(`42${JSON.stringify([event, payload])}`);
      }
    });
  });
}

/**
 * Le scenario : attendre l'accuse de connexion `40{sid}` et emettre dans le
 * MEME tour d'evenement. Socket.IO a cree la socket et branche les
 * gestionnaires ; `handleConnection` est encore suspendue sur son
 * authentification.
 */
it('ne laisse aucun message atteindre un gestionnaire pendant l authentification', async () => {
  const answers = await attack('jwt.p_lent', 'invite:create', {}, 0, true);

  /**
   * `invite:created` serait la preuve du contournement : une invitation
   * creee au nom de `undefined`, sans limite de debit et sans que la charge
   * utile soit passee par son schema.
   */
  expect(answers.some((answer) => answer.includes('invite:created'))).toBe(false);
}, 20_000);

/** Le meme paquet, une fois l'authentification finie, doit passer. */
it('laisse passer le meme message une fois l authentification terminee', async () => {
  const answers = await attack('jwt.p_apres', 'invite:create', {}, AUTH_DELAY_MS * 3);
  expect(answers.some((answer) => answer.includes('invite:created'))).toBe(true);
}, 20_000);

/**
 * Un jeton invalide qui tente la meme chose n'obtient rien non plus — et
 * surtout pas avant que la deconnexion arrive.
 */
it('refuse un jeton invalide sans jamais rien executer pour lui', async () => {
  const answers = await attack('bidon', 'invite:create', {}, 0, true);
  expect(answers.some((answer) => answer.includes('invite:created'))).toBe(false);
  expect(answers.some((answer) => answer.includes('UNAUTHORIZED'))).toBe(true);
}, 20_000);

/**
 * Les deux trames dans la meme ecriture : Socket.IO ferme la connexion de
 * lui-meme, avant meme l'accuse. Une deuxieme barriere, qu'on ne controle pas
 * et sur laquelle on ne s'appuie donc pas.
 */
it('voit Socket.IO fermer la connexion quand les trames sont collees', async () => {
  const answers = await attack('jwt.p_collees', 'invite:create', {});
  expect(answers).toEqual([]);
}, 20_000);

/**
 * `socket.io-parser` accepte un nom d'evenement NUMERIQUE : rien n'oblige le
 * client a envoyer une chaine. `onAny` livrait alors le nombre tel quel
 * pendant que le filtre entrant soldait sa version chaine — et `7 === "7"`
 * est faux.
 *
 * La fenetre ne se soldait donc jamais : elle gonflait `unmatched`, que le
 * relevé promet a zero, et restait en file jusqu'a l'eviction a trente-deux.
 * Un client rendait ainsi illisibles les deux temoins de fiabilite d'un banc
 * de charge, a volonte.
 *
 * Ce test ne peut pas s'ecrire avec `socket.io-client`, qui n'emet que des
 * noms en chaine : il lui faut une socket brute.
 */
it('solde la fenetre ouverte par un nom d evenement numerique', async () => {
  const before = metrics.snapshot();
  if (!before.enabled) throw new Error('mesure eteinte');

  await attack('jwt.p_numerique', 7, {}, AUTH_DELAY_MS * 3);

  const after = metrics.snapshot();
  if (!after.enabled) throw new Error('mesure eteinte');
  expect(after.messages.rejected).toBeGreaterThan(before.messages.rejected);
  expect(after.unmatched).toBe(before.unmatched);
}, 20_000);
