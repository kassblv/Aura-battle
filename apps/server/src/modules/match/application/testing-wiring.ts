import type { Provider } from '@nestjs/common';
import type { BalanceConfig } from '@aura/rules';
import { BALANCE } from '@aura/rules';
import { GhostNotifier } from '../../matchmaking/adapters/ghost-notifier.js';
import { MemoryGhostStore } from '../../matchmaking/adapters/memory-ghost.store.js';
import { MemoryQueueStore } from '../../matchmaking/adapters/memory-queue.store.js';
import { GhostDirector } from '../../matchmaking/application/ghost-director.js';
import { GhostFallbackService } from '../../matchmaking/application/ghost-fallback.service.js';
import { GhostRecorderService } from '../../matchmaking/application/ghost-recorder.service.js';
import { QueueWorker } from '../../matchmaking/application/queue-worker.js';
import { MatchmakingQueue } from '../../matchmaking/application/queue.service.js';
import {
  GHOST_RECORDING_STORE,
  QUEUE_TICKET_STORE,
  RATING_READER,
  RECENT_OPPONENT_STORE,
  type GhostRecordingStore,
  type QueueTicketStore,
  type RatingReader,
  type RecentOpponentStore,
} from '../../matchmaking/domain/ports.js';
import { RATING_DIRECTORY, type RatingDirectory } from '../../rating/domain/ports.js';
import { SocketNotifier } from '../adapters/socket-notifier.js';
import type { MatchClock } from '../domain/ports.js';
import { TimeoutScheduler, SystemMatchClock } from '../adapters/timeout-scheduler.js';
import { MatchOpener } from './match-opener.js';
import { MatchRuntime } from './match-runtime.js';

/**
 * Cablage de la file d'attente pour les tests de bout en bout.
 *
 * Meme assemblage que `match.module.ts`, a une substitution pres : la file
 * tient en memoire au lieu d'aller dans Redis, et personne n'est classe. Ce qui
 * est teste reste le vrai service, le vrai worker et le vrai chemin
 * d'ouverture — seules les frontieres changent.
 *
 * Il vit a cote du code plutot que dans un fichier de test parce que trois
 * suites en ont besoin : recopie trois fois, cet assemblage aurait derive.
 */

/** Personne n'est classe : tout le monde part de la valeur par defaut. */
const NO_RATINGS: RatingReader = {
  mmrOf: () => Promise.resolve(new Map<string, number>()),
};

/**
 * Delais de bascule vers un fantome, raccourcis pour les tests.
 *
 * Les vrais — 25 s et 12 s — sont ceux de `GHOST_FALLBACK_MS` (docs/05), et
 * `domain/ghost.test.ts` verifie qu'ils n'ont pas bouge. Ici, seule la
 * **mecanique** est eprouvee : attendre vingt-cinq secondes par scenario
 * rendrait la suite inutilisable, donc personne ne l'ecrirait.
 */
export const TEST_GHOST_FALLBACK_MS = { ranked: 400, casual: 200 } as const;

/** Personne n'a de ligue connue : `match.gateway.ts` retombe sur sa valeur par defaut. */
const NO_LEAGUES: RatingDirectory = {
  leaguesOf: () => Promise.resolve(new Map<string, string>()),
};

export function matchmakingTestProviders(
  options: {
    withWorker?: boolean;
    /**
     * Cable la bascule vers un fantome (docs/05). Les suites qui n'en veulent
     * pas gardent exactement le comportement d'avant : la file n'apparie que
     * des humains, et un joueur seul attend.
     */
    withGhosts?: boolean;
    /** Memes valeurs de jeu que le runtime de la suite : le rejeu s'y cale. */
    config?: BalanceConfig;
    /**
     * Heure lue par l'ouverture pour la variante de la semaine (M10). Absente,
     * tout se joue en regles normales : une suite ne doit pas changer de
     * resultat selon la semaine ou on la lance.
     */
    rulesClock?: MatchClock;
  } = {},
): Provider[] {
  const providers: Provider[] = [
    { provide: MemoryQueueStore, useFactory: () => new MemoryQueueStore() },
    {
      provide: QUEUE_TICKET_STORE,
      inject: [MemoryQueueStore],
      useFactory: (store: MemoryQueueStore) => store,
    },
    {
      provide: RECENT_OPPONENT_STORE,
      inject: [MemoryQueueStore],
      useFactory: (store: MemoryQueueStore) => store,
    },
    { provide: RATING_READER, useValue: NO_RATINGS },
    { provide: RATING_DIRECTORY, useValue: NO_LEAGUES },
    {
      provide: MatchmakingQueue,
      inject: [QUEUE_TICKET_STORE, RECENT_OPPONENT_STORE, RATING_READER, SocketNotifier],
      useFactory: (
        tickets: QueueTicketStore,
        recent: RecentOpponentStore,
        ratings: RatingReader,
        notifier: SocketNotifier,
      ) => new MatchmakingQueue(tickets, recent, ratings, notifier),
    },
    {
      provide: MatchOpener,
      inject: [MatchRuntime, SocketNotifier, MatchmakingQueue],
      useFactory: (runtime: MatchRuntime, notifier: SocketNotifier, queue: MatchmakingQueue) =>
        new MatchOpener(runtime, notifier, notifier, queue, null, options.rulesClock ?? null),
    },
  ];

  if (options.withGhosts === true) {
    /**
     * Meme assemblage que `match.module.ts`, meme ordre — et c'est lui qui
     * evite le cycle : le directeur ne connait pas le runtime, ce sont ses
     * appelants qui lui apportent de quoi agir.
     *
     * Les delais de bascule sont raccourcis : un test de bout en bout ne peut
     * pas attendre vingt-cinq secondes par scenario. Les valeurs de docs/05
     * sont verifiees telles quelles par `domain/ghost.test.ts`.
     */
    providers.push(
      { provide: MemoryGhostStore, useFactory: () => new MemoryGhostStore() },
      {
        provide: GHOST_RECORDING_STORE,
        inject: [MemoryGhostStore],
        useFactory: (store: MemoryGhostStore) => store,
      },
      {
        provide: GhostDirector,
        inject: [TimeoutScheduler, SystemMatchClock],
        useFactory: (scheduler: TimeoutScheduler, clock: SystemMatchClock) =>
          new GhostDirector(scheduler, clock, options.config ?? BALANCE),
      },
      {
        provide: GhostNotifier,
        inject: [SocketNotifier, GhostDirector],
        useFactory: (notifier: SocketNotifier, director: GhostDirector) =>
          new GhostNotifier(notifier, director),
      },
      {
        provide: GhostRecorderService,
        inject: [GHOST_RECORDING_STORE, RATING_READER],
        useFactory: (store: GhostRecordingStore, ratings: RatingReader) =>
          new GhostRecorderService(store, ratings),
      },
      {
        provide: GhostFallbackService,
        inject: [MatchmakingQueue, GHOST_RECORDING_STORE, MatchOpener, GhostDirector, MatchRuntime],
        useFactory: (
          queue: MatchmakingQueue,
          store: GhostRecordingStore,
          opener: MatchOpener,
          director: GhostDirector,
          runtime: MatchRuntime,
        ) =>
          new GhostFallbackService(
            queue,
            store,
            opener,
            director,
            runtime,
            null,
            undefined,
            TEST_GHOST_FALLBACK_MS,
          ),
      },
    );
  }

  if (options.withWorker === true) {
    providers.push({
      provide: QueueWorker,
      inject: [
        MatchmakingQueue,
        MatchOpener,
        SocketNotifier,
        MatchRuntime,
        ...(options.withGhosts === true ? [GhostFallbackService] : []),
      ],
      useFactory: (
        queue: MatchmakingQueue,
        opener: MatchOpener,
        notifier: SocketNotifier,
        runtime: MatchRuntime,
        ghosts?: GhostFallbackService,
      ) =>
        new QueueWorker(
          queue,
          opener,
          { now: () => Date.now() },
          {
            isConnected: (playerId: string) => notifier.isConnected(playerId),
            isBusy: (playerId: string) => runtime.isBusy(playerId),
          },
          null,
          undefined,
          ghosts ?? null,
        ),
    });
  }

  return providers;
}
