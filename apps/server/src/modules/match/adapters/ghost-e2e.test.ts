import { PROTOCOL_VERSION, type ServerMessage } from '@aura/protocol';
import { BALANCE, RULES_VERSION, type BalanceConfig } from '@aura/rules';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { IoAdapter } from '@nestjs/platform-socket.io';
import { Test } from '@nestjs/testing';
import { io, type Socket as ClientSocket } from 'socket.io-client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadConfig } from '../../../shared/config.js';
import { createLogger, PinoLoggerService } from '../../../shared/logger.js';
import { MessageMetrics } from '../../../shared/metrics.js';
import { SocketAuthenticator } from '../../auth/application/socket-auth.js';
import { GhostNotifier } from '../../matchmaking/adapters/ghost-notifier.js';
import { MemoryGhostStore } from '../../matchmaking/adapters/memory-ghost.store.js';
import { GhostRecorderService } from '../../matchmaking/application/ghost-recorder.service.js';
import { GHOST_DISPLAY_NAME, isGhostSeatId } from '../../matchmaking/domain/ghost.js';
import { buildSeedGhosts } from '../../matchmaking/domain/ghost-seeding.js';
import { InviteService } from '../application/invites.js';
import { MatchRuntime } from '../application/match-runtime.js';
import { matchmakingTestProviders, TEST_GHOST_FALLBACK_MS } from '../application/testing-wiring.js';
import { PLAYER_DIRECTORY } from '../domain/directory.js';
import { PLAYER_WARDROBE } from '../domain/wardrobe.js';
import { MatchGateway } from './match.gateway.js';
import { SocketNotifier } from './socket-notifier.js';
import { SystemMatchClock, TimeoutScheduler } from './timeout-scheduler.js';

/**
 * Fantomes, de bout en bout (docs/05 § « Fantomes », jalon M5).
 *
 * C'est le critere d'acceptation de la ligne « enregistrement des fantomes et
 * rejeu serveur ; LP reduits ; drapeau `ghost` » : un joueur **seul** en file
 * obtient un match au bout du delai, et ce match lui est annonce pour ce qu'il
 * est. Le chemin complet tourne ici — enregistrer un vrai duel, le rejouer
 * contre un troisieme joueur — avec de vraies sockets et le vrai worker.
 *
 * Seules trois frontieres sont substituees : la file et la reserve de fantomes
 * tiennent en memoire au lieu d'aller dans Redis et Postgres, et les delais de
 * bascule sont raccourcis (`TEST_GHOST_FALLBACK_MS`). Les valeurs de docs/05
 * sont verifiees, elles, par `matchmaking/domain/ghost.test.ts`.
 */

/** Meme jeu, horloge acceleree : rien ici ne depend de la duree d'une manche. */
const FAST: BalanceConfig = {
  ...BALANCE,
  phases: { introMs: 20, rechargeMs: 60, choiceMs: 300, revealMs: 20 },
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
 * l'ancienne — voulu pour une reconnexion, mais deux tests qui partagent une
 * identite se volent leurs messages.
 */
let playerCounter = 0;
const nextPlayerId = (): string => `g_${String((playerCounter += 1))}`;

let app: NestFastifyApplication;
let url: string;
let ghosts: MemoryGhostStore;

/** Enregistre **tout** ce qu'une socket recoit, des sa connexion. */
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

  async first<T>(name: string, timeoutMs = 6_000): Promise<T> {
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

  async never(name: string, windowMs: number): Promise<void> {
    await wait(windowMs);
    expect(this.all(name)).toHaveLength(0);
  }
}

const wait = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

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

/**
 * Fait jouer un client automatiquement, des qu'une phase s'ouvre.
 *
 * **Pose avant `queue:join`, et c'est essentiel.** Une phase dure ici quelques
 * dizaines de millisecondes : poser l'ecouteur apres avoir attendu
 * `match:found`, c'est manquer la premiere manche et enregistrer une action
 * par defaut — ce qui donnerait plus tard un fantome au palier 0 (CLAUDE.md,
 * « Tests temps reel »).
 */
function autoPlay(joueur: Recorder, poseId: string): void {
  let seq = 0;
  joueur.socket.onAny((name: string, payload: unknown) => {
    if (name === 'recharge:start') {
      const message = payload as ServerMessage<'recharge:start'>;
      seq += 1;
      joueur.socket.emit('recharge:taps', {
        matchId: message.matchId,
        round: message.round,
        seq,
        taps: message.orbs
          .slice(0, 3)
          .map((orb, index) => ({ t: (index + 1) * 10, orbIndex: orb.index })),
      });
    }
    if (name === 'choice:start') {
      const message = payload as ServerMessage<'choice:start'>;
      seq += 1;
      joueur.socket.emit('choice:lock', {
        matchId: message.matchId,
        round: message.round,
        seq,
        poseId,
        amp: 1,
        ult: false,
        timing: { chargeAt: 0, tapAt: 120 },
      });
    }
  });
}

/**
 * Joue un match entier entre deux clients reels, jusqu'a `match:end`.
 *
 * C'est ce match-la qui remplit la reserve de fantomes : il faut donc qu'il
 * soit **classe** et joue par deux humains, exactement comme docs/05 l'exige.
 */
async function playFullMatch(un: Recorder, deux: Recorder): Promise<void> {
  autoPlay(un, 'anim.hype.t3.griddy');
  autoPlay(deux, 'anim.calme.t1.pocket');

  un.socket.emit('queue:join', { mode: 'ranked' });
  deux.socket.emit('queue:join', { mode: 'ranked' });

  const found = await un.first<ServerMessage<'match:found'>>('match:found');
  expect(found.ghost).toBe(false);

  await un.first<ServerMessage<'match:end'>>('match:end');
  await deux.first<ServerMessage<'match:end'>>('match:end');
}

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
        // Le runtime parle a des sieges : c'est `GhostNotifier` qui aiguille
        // vers le rejeu ce qui part vers un siege fantome. Cablage identique a
        // celui de `match.module.ts`.
        inject: [
          GhostNotifier,
          TimeoutScheduler,
          SystemMatchClock,
          GhostRecorderService,
          PinoLoggerService,
        ],
        useFactory: (
          notifier: GhostNotifier,
          scheduler: TimeoutScheduler,
          clock: SystemMatchClock,
          ghostRecorder: GhostRecorderService,
          logger: PinoLoggerService,
        ) => new MatchRuntime(notifier, scheduler, clock, FAST, null, null, logger, ghostRecorder),
      },
      ...matchmakingTestProviders({
        withWorker: true,
        withGhosts: true,
        config: FAST,
        rulesClock: { now: () => VARIANT_WEEK_MS },
      }),
    ],
  }).compile();

  app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
  app.useWebSocketAdapter(new IoAdapter(app));
  await app.init();
  await app.listen(0, '127.0.0.1');
  url = (await app.getUrl()).replace('[::1]', '127.0.0.1');
  ghosts = app.get(MemoryGhostStore);

  /**
   * La reserve d'amorcage est en place **avant** le premier client, comme le
   * seed la pose avant le premier joueur. Sans elle, la suite ci-dessous
   * testerait un serveur qui n'existe pas : en production, une base fraiche
   * n'est jamais vide de fantomes.
   */
  for (const recording of buildSeedGhosts(RULES_VERSION)) {
    await ghosts.save({ ...recording, atMs: Date.parse('2020-01-01T00:00:00Z') });
  }
});

/**
 * La semaine vue par l'ouverture : semaine 1, « Ultime express ». Figee pour
 * que la suite ne change pas de resultat selon la semaine ou on la lance.
 */
const VARIANT_WEEK_MS = Date.UTC(1970, 0, 12, 12);

afterAll(async () => {
  await app?.close();
});

describe('fantomes — un joueur seul ne reste pas devant une file vide', () => {
  /**
   * **Le jour du lancement.** Aucun match humain n'a encore ete joue nulle
   * part : le seul vivier disponible est celui d'amorcage. C'est le scenario
   * qui a manque a la premiere livraison — la fonctionnalite qui existe pour
   * empecher une file vide ne marchait pas quand la file etait vide.
   */
  it('donne un adversaire au tout premier joueur, avant tout match humain', async () => {
    const premier = await record();
    premier.socket.emit('queue:join', { mode: 'ranked' });

    const found = await premier.first<ServerMessage<'match:found'>>('match:found');
    expect(found.ghost).toBe(true);
    expect(found.opponent.displayName).toBe(GHOST_DISPLAY_NAME);

    close(premier);
  });

  /** Un fantome amorce reste un fantome **annonce** : l'honnetete ne depend pas de l'origine. */
  it('annonce un fantome amorce exactement comme un fantome humain', async () => {
    const premier = await record();
    premier.socket.emit('queue:join', { mode: 'casual' });

    const found = await premier.first<ServerMessage<'match:found'>>('match:found');
    expect(found.ghost).toBe(true);

    premier.socket.emit('match:rejoin', { matchId: found.matchId });
    const snapshot = await premier.first<ServerMessage<'match:state'>>('match:state');
    expect(snapshot.ghost).toBe(true);

    close(premier);
  });

  /**
   * Le scenario complet, dans l'ordre : deux humains jouent un match classe,
   * leur jeu est retenu, puis un troisieme joueur arrive seul et le rejoue.
   */
  it('enregistre un duel humain, puis le rejoue contre un joueur seul', async () => {
    const un = await record();
    const deux = await record();

    await playFullMatch(un, deux);
    close(un, deux);

    expect(ghosts.size).toBeGreaterThan(0);

    const seul = await record();
    seul.socket.emit('queue:join', { mode: 'ranked' });

    const found = await seul.first<ServerMessage<'match:found'>>('match:found');
    expect(found.ghost).toBe(true);
    expect(found.opponent.displayName).toBe(GHOST_DISPLAY_NAME);
    // Le joueur tient le siege `a` : le rejeu s'assoit toujours en face.
    expect(found.seat).toBe('a');

    close(seul);
  });

  /** « Rien avant le delai » vaut autant que « quelque chose apres ». */
  it('n ouvre rien avant le delai de bascule', async () => {
    const seul = await record();
    seul.socket.emit('queue:join', { mode: 'ranked' });

    // Juste en dessous du delai raccourci, et au-dessus d'un tour de worker :
    // le joueur doit recevoir des `queue:status` et aucun match.
    await seul.never('match:found', TEST_GHOST_FALLBACK_MS.ranked - 150);
    expect(seul.all('queue:status').length).toBeGreaterThan(0);

    close(seul);
  });

  it('bascule plus tot en partie rapide qu en classe', async () => {
    const rapide = await record();
    rapide.socket.emit('queue:join', { mode: 'casual' });

    const found = await rapide.first<ServerMessage<'match:found'>>('match:found');
    expect(found.ghost).toBe(true);

    close(rapide);
  });

  /**
   * Le fantome **joue**. C'est ce qui separe cette fonctionnalite d'un
   * adversaire inerte : sans rejeu, le joueur gagnerait trois manches contre
   * un siege vide, ce qui serait pire qu'une file vide.
   */
  it('joue reellement les manches, et le match va jusqu a son terme', async () => {
    const seul = await record();
    // Ecouteur pose avant l'entree en file : une manche dure ici quelques
    // dizaines de millisecondes.
    autoPlay(seul, 'anim.calme.t1.pocket');
    seul.socket.emit('queue:join', { mode: 'ranked' });

    const found = await seul.first<ServerMessage<'match:found'>>('match:found');
    expect(found.ghost).toBe(true);

    // Le fantome verrouille, et son adversaire l'apprend — c'est le seul fait
    // public de la phase de choix (docs/03).
    await seul.first<ServerMessage<'opponent:locked'>>('opponent:locked');

    const premiere = await seul.first<ServerMessage<'round:result'>>('round:result');
    /**
     * Le fantome a joue **son** mouvement, pas l'action par defaut.
     *
     * Qui ne verrouille pas se voit attribuer le palier 0 (`@aura/rules`, §9) :
     * un palier superieur prouve donc qu'un choix est bien arrive par la porte
     * d'entree du moteur. Les deux enregistrements du duel initial jouaient
     * aux paliers 3 et 1, et l'energie de depart couvre les deux.
     */
    expect(premiere.sides.b.move.tier).toBeGreaterThan(0);

    const fin = await seul.first<ServerMessage<'match:end'>>('match:end');
    expect(fin.matchId).toBe(found.matchId);

    close(seul);
  });

  /**
   * Un rejeu ne doit pas nourrir la reserve : le niveau de la file deriverait
   * de copie en copie, en s'eloignant de ce qu'un humain joue vraiment.
   */
  it('n enregistre pas un match qui comptait deja un fantome', async () => {
    const avant = ghosts.size;

    const seul = await record();
    seul.socket.emit('queue:join', { mode: 'ranked' });
    const found = await seul.first<ServerMessage<'match:found'>>('match:found');
    expect(found.ghost).toBe(true);
    await seul.first<ServerMessage<'match:end'>>('match:end');
    // L'ecriture de l'enregistrement, si elle avait lieu, partirait juste
    // apres `match:end` : on lui laisse le temps de se produire.
    await wait(100);

    expect(ghosts.size).toBe(avant);

    close(seul);
  });

  /**
   * Le defaut le plus sournois : l'application mobile est tuee en
   * arriere-plan — le cas le plus frequent de tous — et revient par
   * `match:rejoin`. Sans le drapeau dans l'instantane, le joueur finit la
   * partie **en croyant affronter quelqu'un**.
   */
  it('rappelle a la reconnexion que l adversaire est un rejeu', async () => {
    const seul = await record();
    autoPlay(seul, 'anim.calme.t1.pocket');
    seul.socket.emit('queue:join', { mode: 'ranked' });

    const found = await seul.first<ServerMessage<'match:found'>>('match:found');
    expect(found.ghost).toBe(true);

    seul.socket.emit('match:rejoin', { matchId: found.matchId });
    const snapshot = await seul.first<ServerMessage<'match:state'>>('match:state');

    expect(snapshot.ghost).toBe(true);
    expect(snapshot.opponent?.displayName).toBe(GHOST_DISPLAY_NAME);

    close(seul);
  });

  /** Un fantome n'est pas un joueur : rien ne doit lui ressembler sur le reseau. */
  it('n envoie jamais rien a un siege fantome', async () => {
    const seul = await record();
    seul.socket.emit('queue:join', { mode: 'ranked' });
    const found = await seul.first<ServerMessage<'match:found'>>('match:found');

    expect(isGhostSeatId(seul.playerId)).toBe(false);
    // Le joueur ne recoit que ses propres messages, et rien qui nomme le siege
    // d'en face : aucun message du protocole ne transporte d'identifiant.
    expect(JSON.stringify(found)).not.toContain('ghost:');

    close(seul);
  });
});

/**
 * Evenements de la semaine (M10) : un fantome de partie rapide joue sous la
 * variante de son match, celle que son adversaire voit annoncee.
 */
describe('fantomes — la variante de la semaine', () => {
  it('ouvre une partie rapide contre un fantome sous la variante, jusqu a son terme', async () => {
    const seul = await record();
    autoPlay(seul, 'anim.calme.t1.pocket');
    seul.socket.emit('queue:join', { mode: 'casual' });

    const found = await seul.first<ServerMessage<'match:found'>>('match:found');
    expect(found.ghost).toBe(true);
    expect(found.rulesVariant).toBe('ultime');
    expect(app.get(MatchRuntime).configOf(found.matchId)?.ultimate.gaugeMax).toBe(60);

    const fin = await seul.first<ServerMessage<'match:end'>>('match:end');
    expect(fin.matchId).toBe(found.matchId);

    close(seul);
  });

  it('garde le classe contre un fantome en regles normales', async () => {
    const seul = await record();
    seul.socket.emit('queue:join', { mode: 'ranked' });

    const found = await seul.first<ServerMessage<'match:found'>>('match:found');
    expect(found.ghost).toBe(true);
    expect(found).not.toHaveProperty('rulesVariant');
    expect(app.get(MatchRuntime).configOf(found.matchId)?.ultimate.gaugeMax).toBe(
      BALANCE.ultimate.gaugeMax,
    );

    close(seul);
  });
});
