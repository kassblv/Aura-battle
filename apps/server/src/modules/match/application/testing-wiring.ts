import type { Provider } from '@nestjs/common';
import { PLAYER_DIRECTORY, type PlayerDirectory } from '../domain/directory.js';
import { MemoryQueueStore } from '../../matchmaking/adapters/memory-queue.store.js';
import { QueueWorker } from '../../matchmaking/application/queue-worker.js';
import { MatchmakingQueue } from '../../matchmaking/application/queue.service.js';
import {
  QUEUE_TICKET_STORE,
  RATING_READER,
  RECENT_OPPONENT_STORE,
  type QueueTicketStore,
  type RatingReader,
  type RecentOpponentStore,
} from '../../matchmaking/domain/ports.js';
import { SocketNotifier } from '../adapters/socket-notifier.js';
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

export function matchmakingTestProviders(options: { withWorker?: boolean } = {}): Provider[] {
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
      inject: [MatchRuntime, SocketNotifier, PLAYER_DIRECTORY, MatchmakingQueue],
      useFactory: (
        runtime: MatchRuntime,
        notifier: SocketNotifier,
        directory: PlayerDirectory,
        queue: MatchmakingQueue,
      ) => new MatchOpener(runtime, notifier, notifier, directory, queue),
    },
  ];

  if (options.withWorker === true) {
    providers.push({
      provide: QueueWorker,
      inject: [MatchmakingQueue, MatchOpener, SocketNotifier, MatchRuntime],
      useFactory: (
        queue: MatchmakingQueue,
        opener: MatchOpener,
        notifier: SocketNotifier,
        runtime: MatchRuntime,
      ) =>
        new QueueWorker(
          queue,
          opener,
          { now: () => Date.now() },
          (playerId: string) => notifier.isConnected(playerId) && !runtime.isBusy(playerId),
        ),
    });
  }

  return providers;
}
