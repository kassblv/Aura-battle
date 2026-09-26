import { Module } from '@nestjs/common';
import { BALANCE } from '@aura/rules';
import { PinoLoggerService } from '../../shared/logger.js';
import { MessageMetrics } from '../../shared/metrics.js';
import { RedisModule } from '../../shared/redis.module.js';
import { RedisService } from '../../shared/redis.js';
import { PrismaService } from '../../shared/prisma.service.js';
import { AuthModule } from '../auth/auth.module.js';
import { FeatureFlags } from '../flags/application/feature-flags.js';
import { FlagsModule } from '../flags/flags.module.js';
import { CredentialsEvents } from '../auth/application/credentials-events.js';
import { GhostNotifier } from '../matchmaking/adapters/ghost-notifier.js';
import { PrismaGhostStore } from '../matchmaking/adapters/prisma-ghost.store.js';
import { PrismaRatingReader } from '../matchmaking/adapters/prisma-rating.reader.js';
import { RedisQueueStore } from '../matchmaking/adapters/redis-queue.store.js';
import { GhostDirector } from '../matchmaking/application/ghost-director.js';
import { GhostFallbackService } from '../matchmaking/application/ghost-fallback.service.js';
import { GhostRecorderService } from '../matchmaking/application/ghost-recorder.service.js';
import { QueueWorker } from '../matchmaking/application/queue-worker.js';
import { MatchmakingQueue } from '../matchmaking/application/queue.service.js';
import {
  GHOST_RECORDING_STORE,
  QUEUE_TICKET_STORE,
  RECENT_OPPONENT_STORE,
  type GhostRecordingStore,
  type QueueTicketStore,
  type RecentOpponentStore,
} from '../matchmaking/domain/ports.js';
import { PrismaRatingRepository } from '../rating/adapters/prisma-rating.repository.js';
import { LeaderboardController } from '../rating/adapters/leaderboard.controller.js';
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
import { ChallengeService } from '../challenges/application/challenges.js';
import { ChallengesModule } from '../challenges/challenges.module.js';
import { PrismaInventoryRepository } from '../inventory/adapters/prisma-inventory.repository.js';
import { InventoryStoreModule } from '../inventory/inventory-store.module.js';
import { INVENTORY_CHANGES } from '../inventory/domain/ports.js';
import { wardrobeFromInventory, WearingRefresh } from './application/wearing.js';
import { PLAYER_DIRECTORY } from './domain/directory.js';
import { PLAYER_WARDROBE, type PlayerWardrobe } from './domain/wardrobe.js';
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
/** Jeton du provider qui declare les compteurs vivants du module. */
const MATCH_GAUGES = Symbol('MATCH_GAUGES');

@Module({
  // `InventoryStoreModule` : le depot d'inventaire, en un seul exemplaire
  // partage avec `InventoryModule` — donc un seul cache du catalogue.
  // `FlagsModule` : l'affectation aux experiences, lue a l'ouverture des matchs.
  imports: [AuthModule, RedisModule, ChallengesModule, InventoryStoreModule, FlagsModule],
  controllers: [LeaderboardController],
  providers: [
    {
      provide: SocketNotifier,
      inject: [PinoLoggerService, MessageMetrics, CredentialsEvents],
      useFactory: (
        logger: PinoLoggerService,
        metrics: MessageMetrics,
        events: CredentialsEvents,
      ) => {
        const notifier = new SocketNotifier(logger, metrics);
        // Un changement de mot de passe ferme les sockets du joueur (ADR 0013).
        events.subscribe((playerId) => {
          notifier.disconnectPlayer(playerId);
        });
        return notifier;
      },
    },
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
    // Le meme depot lit aussi le classement general : le tri et le rang
    // viennent de la base, la ou vit l'index `(seasonId, leaguePoints)`.
    {
      provide: 'LEADERBOARD_READER',
      inject: [PrismaRatingRepository],
      useFactory: (repository: PrismaRatingRepository) => repository,
    },
    {
      provide: RatingSettlementService,
      inject: [
        RATING_LOOKUP,
        RATING_WRITER,
        SocketNotifier,
        PinoLoggerService,
        PrismaRatingRepository,
      ],
      useFactory: (
        lookup: RatingLookup,
        writer: RatingWriter,
        // `SocketNotifier` realise aussi `PresenceLeagueCache` : la ligue mise
        // en cache a la connexion doit etre la meme qu'on rafraichit ici.
        presenceCache: SocketNotifier,
        logger: PinoLoggerService,
        // Le meme depot realise `WalletCredit` : la recompense annoncee a la
        // fin du match est creditee la, au lieu d'etre laissee au client.
        wallets: PrismaRatingRepository,
      ) => new RatingSettlementService(lookup, writer, presenceCache, logger, wallets),
    },

    /**
     * Fantomes (docs/05). L'ordre de construction n'a rien d'arbitraire et
     * c'est lui qui **evite un cycle** : le chef d'orchestre du rejeu ne
     * connait pas le runtime, ce sont ses appelants qui lui apportent de quoi
     * agir. Le directeur ne depend donc que d'une horloge et d'un ordonnanceur,
     * le notifier depend du directeur, le runtime du notifier, et la bascule —
     * construite en dernier — des trois.
     */
    {
      provide: PrismaGhostStore,
      inject: [PrismaService],
      useFactory: (prisma: PrismaService) => new PrismaGhostStore(prisma),
    },
    {
      provide: GHOST_RECORDING_STORE,
      inject: [PrismaGhostStore],
      useFactory: (store: PrismaGhostStore) => store,
    },
    {
      provide: GhostDirector,
      inject: [TimeoutScheduler, SystemMatchClock, PinoLoggerService],
      useFactory: (
        scheduler: TimeoutScheduler,
        clock: SystemMatchClock,
        logger: PinoLoggerService,
      ) => new GhostDirector(scheduler, clock, BALANCE, logger),
    },
    {
      provide: GhostNotifier,
      inject: [SocketNotifier, GhostDirector, PinoLoggerService],
      useFactory: (notifier: SocketNotifier, director: GhostDirector, logger: PinoLoggerService) =>
        new GhostNotifier(notifier, director, logger),
    },
    {
      provide: GhostRecorderService,
      inject: [GHOST_RECORDING_STORE, PrismaRatingReader, PinoLoggerService],
      useFactory: (
        store: GhostRecordingStore,
        ratings: PrismaRatingReader,
        logger: PinoLoggerService,
      ) => new GhostRecorderService(store, ratings, logger),
    },

    {
      provide: MatchRuntime,
      inject: [
        GhostNotifier,
        TimeoutScheduler,
        SystemMatchClock,
        PrismaMatchRepository,
        RatingSettlementService,
        PinoLoggerService,
        GhostRecorderService,
        ChallengeService,
      ],
      useFactory: (
        // Le runtime parle a des **sieges**, pas a des sockets : ce notifier-la
        // aiguille vers le rejeu ce qui part vers un siege fantome, et vers la
        // socket tout le reste.
        notifier: GhostNotifier,
        scheduler: TimeoutScheduler,
        clock: SystemMatchClock,
        repository: PrismaMatchRepository,
        ratingSettlement: RatingSettlementService,
        logger: PinoLoggerService,
        ghostRecorder: GhostRecorderService,
        challenges: ChallengeService,
      ) =>
        new MatchRuntime(
          notifier,
          scheduler,
          clock,
          BALANCE,
          repository,
          ratingSettlement,
          logger,
          ghostRecorder,
          challenges,
        ),
    },
    /**
     * Ce que porte un joueur, lu a sa connexion.
     *
     * Le module `match` depend du PORT : il n'a que faire d'une bourse, d'un
     * catalogue ou d'un prix. Il lui faut l'apparence a annoncer a la
     * revelation, et rien d'autre. L'adaptateur de l'inventaire fait deja
     * cette lecture — on la reutilise plutot que d'en ecrire une seconde qui
     * finirait par diverger.
     */
    {
      provide: PLAYER_WARDROBE,
      inject: [PrismaInventoryRepository],
      useFactory: (inventory: PrismaInventoryRepository): PlayerWardrobe =>
        wardrobeFromInventory(inventory),
    },
    /**
     * L'ecoute des changements d'inventaire.
     *
     * L'apparence etait lue a la connexion et nulle part ailleurs : une danse
     * equipee au vestiaire n'etait vue qu'apres une reconnexion. L'inventaire
     * previent par son port, avec l'etat qu'il vient d'ecrire ; le match en
     * tire l'apparence sans relire la base (seul le catalogue, garde en
     * memoire par le depot), met a jour la session, et les danses par
     * mouvement d'un match en cours.
     */
    {
      provide: INVENTORY_CHANGES,
      inject: [PrismaInventoryRepository, SocketNotifier, PinoLoggerService],
      useFactory: (
        inventory: PrismaInventoryRepository,
        notifier: SocketNotifier,
        logger: PinoLoggerService,
      ) =>
        new WearingRefresh(wardrobeFromInventory(inventory), notifier, {
          warn: (message: string) => {
            logger.warn(message, 'WearingRefresh');
          },
        }),
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
      inject: [
        MatchRuntime,
        SocketNotifier,
        MatchmakingQueue,
        PinoLoggerService,
        SystemMatchClock,
        FeatureFlags,
      ],
      useFactory: (
        runtime: MatchRuntime,
        notifier: SocketNotifier,
        queue: MatchmakingQueue,
        logger: PinoLoggerService,
        // L'heure serveur dit la semaine, donc la variante de la partie rapide.
        clock: SystemMatchClock,
        // Le groupe de chaque joueur, donc la bulle d'intention (test A/B).
        flags: FeatureFlags,
      ) =>
        // `SocketNotifier` tient les deux roles : envoyer un message, et dire
        // qui est la et sous quel nom. Ce sont deux ports distincts, parce que
        // ce sont deux questions distinctes.
        new MatchOpener(runtime, notifier, notifier, queue, logger, clock, flags),
    },

    {
      provide: GhostFallbackService,
      inject: [
        MatchmakingQueue,
        GHOST_RECORDING_STORE,
        MatchOpener,
        GhostDirector,
        MatchRuntime,
        PinoLoggerService,
      ],
      useFactory: (
        queue: MatchmakingQueue,
        store: GhostRecordingStore,
        opener: MatchOpener,
        director: GhostDirector,
        // Le fantome agit par les memes methodes qu'un client : c'est le
        // runtime lui-meme qui les realise, sans aucune porte derobee.
        runtime: MatchRuntime,
        logger: PinoLoggerService,
      ) => new GhostFallbackService(queue, store, opener, director, runtime, logger),
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
        GhostFallbackService,
      ],
      useFactory: (
        queue: MatchmakingQueue,
        opener: MatchOpener,
        clock: SystemMatchClock,
        notifier: SocketNotifier,
        runtime: MatchRuntime,
        logger: PinoLoggerService,
        ghosts: GhostFallbackService,
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
          undefined,
          ghosts,
        ),
    },

    MatchGateway,

    /**
     * Compteurs vivants publies a la sonde de charge (jalon M7).
     *
     * Un provider muet, construit pour son effet de bord : il branche trois
     * lectures — matchs, minuteurs, sessions — sur `MessageMetrics`. Les avoir
     * dit deux choses qu'aucune latence ne dit. D'abord que le banc a bien
     * ouvert les 500 matchs qu'il annonce, au lieu de mesurer un serveur a
     * moitie vide. Ensuite qu'un minuteur ou une session qui ne redescend
     * jamais est une fuite, pas une lenteur — deux defauts qui se soignent a
     * des endroits differents.
     */
    {
      provide: MATCH_GAUGES,
      inject: [MessageMetrics, MatchRuntime, TimeoutScheduler, SocketNotifier],
      useFactory: (
        metrics: MessageMetrics,
        runtime: MatchRuntime,
        scheduler: TimeoutScheduler,
        notifier: SocketNotifier,
      ) => {
        metrics.registerGauge('liveMatches', () => runtime.liveMatches);
        metrics.registerGauge('armedTimers', () => scheduler.armed);
        metrics.registerGauge('liveSessions', () => notifier.liveSessions);
        return true;
      },
    },
  ],
  exports: [MatchGateway, MatchRuntime, MatchmakingQueue, INVENTORY_CHANGES],
})
export class MatchModule {}
