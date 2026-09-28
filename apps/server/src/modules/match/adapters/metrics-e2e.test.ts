import { PROTOCOL_VERSION } from '@aura/protocol';
import { BALANCE, type BalanceConfig, type RechargeTap, type Seat } from '@aura/rules';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { IoAdapter } from '@nestjs/platform-socket.io';
import { Test } from '@nestjs/testing';
import { io, type Socket as ClientSocket } from 'socket.io-client';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { loadConfig } from '../../../shared/config.js';
import { createLogger, PinoLoggerService } from '../../../shared/logger.js';
import { MessageMetrics, type MetricsSnapshot } from '../../../shared/metrics.js';
import { MessageTimingInterceptor } from '../../../shared/metrics.interceptor.js';
import { SocketAuthenticator } from '../../auth/application/socket-auth.js';
import { PLAYER_DIRECTORY } from '../domain/directory.js';
import { PLAYER_WARDROBE } from '../domain/wardrobe.js';
import { InviteService } from '../application/invites.js';
import { MatchRuntime } from '../application/match-runtime.js';
import { matchmakingTestProviders } from '../application/testing-wiring.js';
import { MatchGateway } from './match.gateway.js';
import { SocketNotifier } from './socket-notifier.js';
import { SystemMatchClock, TimeoutScheduler } from './timeout-scheduler.js';

/**
 * L'instrumentation de charge, eprouvee sur la vraie pile (jalon M7).
 *
 * Tout le banc de charge repose sur une hypothese : la fenetre mesuree
 * commence au decodage du paquet et se ferme a la fin du gestionnaire. Elle
 * tient a deux details d'implementation qu'aucun test unitaire ne touche — que
 * `socket.onAny` se declenche avant les intergiciels de Socket.IO, et que
 * l'intercepteur de NestJS encadre bien le gestionnaire. Les verifier ici
 * evite de publier des percentiles qui mesureraient tout autre chose.
 *
 * Le temoin est un gestionnaire **volontairement lent** : si les 8 ms qu'il
 * occupe n'apparaissent pas dans la mesure, c'est que le gestionnaire est hors
 * de la fenetre.
 */

const FAST: BalanceConfig = {
  ...BALANCE,
  phases: { introMs: 20, rechargeMs: 3_000, choiceMs: 2_000, revealMs: 20 },
};

/** Temps que le faux gestionnaire de taps passe a occuper la boucle. */
const SLOW_HANDLER_MS = 8;

/**
 * Nombre de lots de taps envoyes.
 *
 * Plusieurs, et pas un seul, pour que les assertions portent sur une
 * **mediane**. La suite tourne trente-neuf fichiers en parallele : un maximum
 * y attrape la pause de ramasse-miettes d'un autre processus, pas le cout du
 * code teste. Une mediane sur six mesures ne bouge pas pour un a-coup.
 */
const TAP_BATCHES = 3;

/**
 * Patience des scenarios, largement au-dessus du defaut de cinq secondes.
 *
 * Ce test attend deux transitions de phase du serveur. Sous la charge d'une
 * suite qui tourne en parallele, elles prennent parfois plus que le defaut de
 * Vitest — et le test echoue alors sur le temps d'attente, pas sur ce qu'il
 * verifie.
 */
const PATIENCE_MS = 30_000;

const serverConfig = loadConfig({
  DATABASE_URL: 'postgresql://inutilise',
  REDIS_URL: 'redis://inutilise',
  JWT_SECRET: 'un-secret-assez-long',
  NODE_ENV: 'test',
});

const subjectOf = (token: string): string | null =>
  token.startsWith('jwt.') && token.length > 4 ? token.slice(4) : null;

let app: NestFastifyApplication;
let url: string;
let metrics: MessageMetrics;

/**
 * Runtime dont l'enregistrement des taps traine.
 *
 * On occupe la boucle plutot que d'attendre : le but est de produire du
 * **travail serveur** mesurable, pas une attente que l'intercepteur verrait
 * passer de toute facon.
 */
class SlowRuntime extends MatchRuntime {
  override submitTaps(matchId: string, seat: Seat, taps: readonly RechargeTap[]): void {
    const until = process.hrtime.bigint() + BigInt(SLOW_HANDLER_MS) * 1_000_000n;
    while (process.hrtime.bigint() < until) {
      /* occupation deliberee de la boucle */
    }
    super.submitTaps(matchId, seat, taps);
  }
}

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

/** Attend qu'une condition du relevé se realise, ou renonce. */
async function until(
  predicate: (snapshot: MetricsSnapshot) => boolean,
  what: string,
  timeoutMs = PATIENCE_MS / 2,
): Promise<MetricsSnapshot> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const snapshot = metrics.snapshot();
    if (!snapshot.enabled) throw new Error('mesure eteinte');
    if (predicate(snapshot)) return snapshot;
    if (Date.now() > deadline) {
      throw new Error(`${what} : jamais atteint (${JSON.stringify(snapshot.messages)})`);
    }
    await new Promise<void>((resolve) => setTimeout(resolve, 25));
  }
}

beforeAll(async () => {
  metrics = new MessageMetrics(true);

  const moduleRef = await Test.createTestingModule({
    providers: [
      MatchGateway,
      InviteService,
      TimeoutScheduler,
      SystemMatchClock,
      { provide: MessageMetrics, useValue: metrics },
      { provide: APP_INTERCEPTOR, useClass: MessageTimingInterceptor },
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
        // Personne ne porte rien de particulier : chacun aura l'effet offert
        // de son palier, comme tout le monde avant la boutique.
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
        ) => new SlowRuntime(notifier, scheduler, clock, FAST),
      },
      ...matchmakingTestProviders(),
    ],
  }).compile();

  app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
  app.useWebSocketAdapter(new IoAdapter(app));
  await app.init();
  await app.listen(0, '127.0.0.1');
  url = (await app.getUrl()).replace('[::1]', '127.0.0.1');

  const runtime = moduleRef.get(MatchRuntime);
  metrics.registerGauge('liveMatches', () => runtime.liveMatches);
});

afterAll(async () => {
  await app?.close();
});

it(
  'mesure le gestionnaire, pas seulement le filtre d entree',
  async () => {
    const host = await connect('jwt.p_metrics_a');
    const guest = await connect('jwt.p_metrics_b');

    const matchId = await new Promise<string>((resolve) => {
      host.on('invite:created', (invite: { code: string }) => {
        guest.emit('invite:join', { code: invite.code });
      });
      host.on('match:found', (found: { matchId: string }) => {
        resolve(found.matchId);
      });
      host.emit('invite:create');
    });

    // Le match est bien vivant : un relevé pris sur un serveur vide dirait la
    // meme chose qu'un relevé sur un serveur rapide.
    expect(metrics.snapshot()).toMatchObject({ gauges: { liveMatches: 1 } });

    const round = await new Promise<number>((resolve) => {
      host.on('recharge:start', (start: { round: number }) => {
        resolve(start.round);
      });
    });

    for (let batch = 1; batch <= TAP_BATCHES; batch += 1) {
      host.emit('recharge:taps', {
        matchId,
        round,
        seq: batch,
        taps: [
          { orbIndex: 0, t: 100 * batch },
          { orbIndex: 1, t: 100 * batch + 20 },
        ],
      });
    }

    const snapshot = await until(
      (taken) => (taken.messages.byEvent['recharge:taps']?.count ?? 0) >= TAP_BATCHES,
      'les lots de taps n ont jamais ete mesures',
    );

    const taps = snapshot.messages.byEvent['recharge:taps']!;
    /**
     * Le gestionnaire occupe 8 ms a **chaque** lot : la mediane doit donc les
     * contenir. Sans le gestionnaire dans la fenetre, la mesure serait de
     * l'ordre de la dizaine de microsecondes — trois ordres de grandeur en
     * dessous.
     */
    expect(taps.p50Ms).toBeGreaterThanOrEqual(SLOW_HANDLER_MS);
    /**
     * Le filtre, lui, ne fait que la limite de debit et la validation de
     * schema. La comparaison porte sur les medianes et non sur les maxima : un
     * maximum attrape la pause de ramasse-miettes du processus voisin, une
     * mediane non.
     */
    expect(snapshot.inboundFilter.p50Ms).toBeLessThan(taps.p50Ms);
    // Aucune trace appariee au hasard : c'est l'invariant qui rend le banc
    // credible.
    expect(snapshot.unmatched).toBe(0);

    host.disconnect();
    guest.disconnect();
  },
  PATIENCE_MS,
);

it(
  'compte aussi ce que le filtre refuse',
  async () => {
    const before = metrics.snapshot();
    if (!before.enabled) throw new Error('mesure eteinte');

    const socket = await connect('jwt.p_metrics_c');
    // Un evenement qui n'existe pas au registre : refuse avant tout gestionnaire,
    // mais il a bien coute du temps serveur.
    socket.emit('nawak', {});

    const snapshot = await until(
      (taken) => taken.messages.rejected > before.messages.rejected,
      'le message refuse n a jamais ete compte',
    );
    /**
     * Compte, mais **pas nomme**.
     *
     * Le nom vient du client : lui donner sa propre entree laissait
     * l'adversaire decider combien la table en contient. Cette epreuve
     * exigeait justement `byEvent.nawak`, donc elle verrouillait le defaut —
     * un test peut figer une faille aussi surement qu'il protege un
     * comportement. Ce qu'elle voulait prouver est ailleurs : le temps passe
     * a refuser reste visible.
     */
    expect(snapshot.messages.byEvent.nawak).toBeUndefined();
    expect(snapshot.messages.byEvent.inconnu?.count).toBeGreaterThanOrEqual(1);
    expect(snapshot.unmatched).toBe(0);

    socket.disconnect();
  },
  PATIENCE_MS,
);
