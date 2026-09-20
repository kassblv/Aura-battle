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
import { PrismaRatingRepository } from '../rating/adapters/prisma-rating.repository.js';
import { RatingSettlementService } from '../rating/application/rating-settlement.service.js';
import {
  RATING_DIRECTORY,
  RATING_LOOKUP,
  RATING_WRITER,
  type RatingLookup,
  type RatingWriter,
} from '../rating/domain/ports.js';
import { MatchGateway } from './adapters/match.gateway.js';
import { PrismaPlayerDirectory } from './adapters/prisma-directory.js';
import { PLAYER_DIRECTORY } from './domain/directory.js';
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

    /**
     * Classement : un seul adaptateur Prisma realise les trois ports — meme
     * raison que `RedisQueueStore` pour la file (ADR 0009).
     */
    {
      provide: PrismaRatingRepository,
      inject: [PrismaService, PinoLoggerService],
      useFactory: (prisma: PrismaService, logger: PinoLoggerService) =>
        new PrismaRatingRepository(prisma, logger),
    },
    {
      provide: RATING_LOOKUP,
      inject: [PrismaRatingRepository],
      useFactory: (repository: PrismaRatingRepository) => repository,
    },
    {
      provide: RATING_WRITER,
      inject: [PrismaRatingRepository],
      useFactory: (repository: PrismaRatingRepository) => repository,
    },
    {
      provide: RATING_DIRECTORY,
      inject: [PrismaRatingRepository],
      useFactory: (repository: PrismaRatingRepository) => repository,
    },
    {
      provide: RatingSettlementService,
      inject: [RATING_LOOKUP, RATING_WRITER, SocketNotifier, PinoLoggerService],
      useFactory: (
        lookup: RatingLookup,
        writer: RatingWriter,
        // `SocketNotifier` realise aussi `PresenceLeagueCache` : la ligue mise
        // en cache a la connexion doit etre la meme qu'on rafraichit ici.
        presenceCache: SocketNotifier,
        logger: PinoLoggerService,
      ) => new RatingSettlementService(lookup, writer, presenceCache, logger),
    },

    {
      provide: MatchRuntime,
      inject: [
        SocketNotifier,
        TimeoutScheduler,
        SystemMatchClock,
        PrismaMatchRepository,
        RatingSettlementService,
        PinoLoggerService,
      ],
      useFactory: (
        notifier: SocketNotifier,
        scheduler: TimeoutScheduler,
        clock: SystemMatchClock,
        repository: PrismaMatchRepository,
        ratingSettlement: RatingSettlementService,
        logger: PinoLoggerService,
      ) =>
        new MatchRuntime(notifier, scheduler, clock, BALANCE, repository, ratingSettlement, logger),
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
      inject: [MatchRuntime, SocketNotifier, MatchmakingQueue, PinoLoggerService],
      useFactory: (
        runtime: MatchRuntime,
        notifier: SocketNotifier,
        queue: MatchmakingQueue,
        logger: PinoLoggerService,
      ) =>
        // `SocketNotifier` tient les deux roles : envoyer un message, et dire
        // qui est la et sous quel nom. Ce sont deux ports distincts, parce que
        // ce sont deux questions distinctes.
        new MatchOpener(runtime, notifier, notifier, queue, logger),
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
          // Deux questions, **transmises separement**. Le worker ne connait ni
          // les sockets ni les matchs en cours ; il a en revanche besoin de
          // savoir laquelle des deux est en cause : un joueur parti garde sa
          // place le temps de revenir, un joueur deja assis la perd.
          {
            isConnected: (playerId: string) => notifier.isConnected(playerId),
            isBusy: (playerId: string) => runtime.isBusy(playerId),
          },
          logger,
        ),
    },

    MatchGateway,
  ],
  exports: [MatchGateway, MatchRuntime, MatchmakingQueue],
})
export class MatchModule {}
