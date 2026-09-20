import { Module } from '@nestjs/common';
import { BALANCE } from '@aura/rules';
import { PinoLoggerService } from '../../shared/logger.js';
import { RedisModule } from '../../shared/redis.module.js';
import { RedisService } from '../../shared/redis.js';
import { PrismaService } from '../../shared/prisma.service.js';
import { AuthModule } from '../auth/auth.module.js';
import { PrismaRatingReader } from '../matchmaking/adapters/prisma-rating.reader.js';
import { RedisQueueStore } from '../matchmaking/adapters/redis-queue.store.js';
import { QueueWorker } from '../matchmaking/application/queue-worker.js';
import { MatchmakingQueue } from '../matchmaking/application/queue.service.js';
import {
  QUEUE_TICKET_STORE,
  RECENT_OPPONENT_STORE,
  type QueueTicketStore,
  type RecentOpponentStore,
} from '../matchmaking/domain/ports.js';
import { MatchGateway } from './adapters/match.gateway.js';
import { PrismaPlayerDirectory } from './adapters/prisma-directory.js';
import { PLAYER_DIRECTORY, type PlayerDirectory } from './domain/directory.js';
import { PrismaMatchRepository } from './adapters/prisma-match.repository.js';
import { SocketNotifier } from './adapters/socket-notifier.js';
import { SystemMatchClock, TimeoutScheduler } from './adapters/timeout-scheduler.js';
import { InviteService } from './application/invites.js';
import { MatchOpener } from './application/match-opener.js';
import { MatchRuntime } from './application/match-runtime.js';

/**
 * Module match et file d'attente (docs/02-architecture.md, docs/05).
 *
 * Le runtime recoit ses ports ici : envoyer passe par les sockets, les
 * echeances par `setTimeout`, le temps par l'horloge systeme, l'ecriture par
 * Prisma. Aucun des quatre n'est connu du runtime lui-meme, ce qui permet de
 * jouer un match entier dans un test sans base et sans attendre une seule
 * seconde reelle.
 *
 * **Pourquoi la file d'attente est cablee ici** plutot que dans son propre
 * module Nest : la passerelle doit traiter `queue:join` — il n'y a qu'une
 * socket authentifiee, donc qu'une passerelle — et le worker doit ouvrir des
 * matchs. Deux modules Nest se seraient donc importes l'un l'autre. Le code,
 * lui, reste separe : `modules/matchmaking/` ne connait rien du module match,
 * il ne voit que les ports `MatchOpening` et `QueueTicketStore`. Le jour ou la
 * passerelle se detachera, le decoupage sera mecanique (ADR 0009).
 */
@Module({
  imports: [AuthModule, RedisModule],
  providers: [
    SocketNotifier,
    TimeoutScheduler,
    SystemMatchClock,
    InviteService,
    PrismaMatchRepository,
    {
      provide: MatchRuntime,
      inject: [SocketNotifier, TimeoutScheduler, SystemMatchClock, PrismaMatchRepository],
      useFactory: (
        notifier: SocketNotifier,
        scheduler: TimeoutScheduler,
        clock: SystemMatchClock,
        repository: PrismaMatchRepository,
      ) => new MatchRuntime(notifier, scheduler, clock, BALANCE, repository),
    },
    PrismaPlayerDirectory,
    // Jeton nomme : la passerelle depend du **port**, pas de Prisma. Le nom
    // affiche est la seule chose que `match` sait d'un joueur.
    {
      provide: PLAYER_DIRECTORY,
      inject: [PrismaPlayerDirectory],
      useFactory: (directory: PrismaPlayerDirectory) => directory,
    },

    /**
     * File d'attente : un seul adaptateur Redis realise les deux ports.
     *
     * Les tickets et la memoire des rencontres vivent dans la meme instance et
     * partagent la meme connexion ; les separer en deux classes ne ferait que
     * dupliquer la connexion sans separer quoi que ce soit.
     */
    {
      provide: RedisQueueStore,
      inject: [RedisService],
      useFactory: (redis: RedisService) => new RedisQueueStore(redis.client),
    },
    {
      provide: QUEUE_TICKET_STORE,
      inject: [RedisQueueStore],
      useFactory: (store: RedisQueueStore) => store,
    },
    {
      provide: RECENT_OPPONENT_STORE,
      inject: [RedisQueueStore],
      useFactory: (store: RedisQueueStore) => store,
    },
    {
      provide: PrismaRatingReader,
      inject: [PrismaService],
      useFactory: (prisma: PrismaService) => new PrismaRatingReader(prisma),
    },
    {
      provide: MatchmakingQueue,
      inject: [
        QUEUE_TICKET_STORE,
        RECENT_OPPONENT_STORE,
        PrismaRatingReader,
        SocketNotifier,
        PinoLoggerService,
      ],
      useFactory: (
        tickets: QueueTicketStore,
        recent: RecentOpponentStore,
        ratings: PrismaRatingReader,
        notifier: SocketNotifier,
        logger: PinoLoggerService,
      ) => new MatchmakingQueue(tickets, recent, ratings, notifier, logger),
    },

    /**
     * Chemin unique d'ouverture : invitation et file d'attente passent par lui.
     * Il sort les deux joueurs de la file, d'ou qu'ils viennent — un ticket qui
     * survit a son joueur ferait apparier quelqu'un qui est deja en duel.
     */
    {
      provide: MatchOpener,
      inject: [MatchRuntime, SocketNotifier, PLAYER_DIRECTORY, MatchmakingQueue, PinoLoggerService],
      useFactory: (
        runtime: MatchRuntime,
        notifier: SocketNotifier,
        directory: PlayerDirectory,
        queue: MatchmakingQueue,
        logger: PinoLoggerService,
      ) =>
        // `SocketNotifier` tient les deux roles : envoyer un message et dire
        // qui est encore au bout d'une socket. Ce sont deux ports distincts,
        // parce que ce sont deux questions distinctes.
        new MatchOpener(runtime, notifier, notifier, directory, queue, logger),
    },

    {
      provide: QueueWorker,
      inject: [
        MatchmakingQueue,
        MatchOpener,
        SystemMatchClock,
        SocketNotifier,
        MatchRuntime,
        PinoLoggerService,
      ],
      useFactory: (
        queue: MatchmakingQueue,
        opener: MatchOpener,
        clock: SystemMatchClock,
        notifier: SocketNotifier,
        runtime: MatchRuntime,
        logger: PinoLoggerService,
      ) =>
        new QueueWorker(
          queue,
          opener,
          clock,
          // Disponible = toujours connecte **et** pas deja assis a un duel.
          // Le worker ne connait ni les sockets ni les matchs : la composition
          // des deux conditions est faite ici, une fois.
          (playerId: string) => notifier.isConnected(playerId) && !runtime.isBusy(playerId),
          logger,
        ),
    },

    MatchGateway,
  ],
  exports: [MatchGateway, MatchRuntime, MatchmakingQueue],
})
export class MatchModule {}
