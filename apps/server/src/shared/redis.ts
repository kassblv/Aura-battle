import { Inject, Injectable, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { createClient, type RedisClientType } from 'redis';
import { CONFIG, type ServerConfig } from './config.js';
import { PinoLoggerService } from './logger.js';

/**
 * Connexion Redis, branchee au cycle de vie de Nest.
 *
 * Redis porte la file d'attente (docs/05) et portera la presence, les verrous
 * et l'adaptateur Socket.IO multi-instances (docs/02). Une seule connexion pour
 * tout le serveur, ouverte au demarrage et fermee a l'arret, sur le modele de
 * `PrismaService`.
 *
 * **node-redis plutot qu'ioredis** : le README d'ioredis recommande lui-meme
 * node-redis pour un nouveau projet et annonce une maintenance « au mieux ».
 */

/** Le client tel que le reste du code le voit. */
export type RedisClient = RedisClientType;

@Injectable()
export class RedisService implements OnModuleInit, OnModuleDestroy {
  readonly client: RedisClient;

  // Jetons explicites : esbuild n'emet pas `design:paramtypes` (voir CLAUDE.md).
  constructor(
    @Inject(CONFIG) config: ServerConfig,
    @Inject(PinoLoggerService) private readonly logger: PinoLoggerService,
  ) {
    this.client = createClient({ url: config.redisUrl });

    /**
     * Un `error` sans ecouteur fait tomber le processus.
     *
     * Ce n'est pas une precaution de style : node-redis emet cet evenement a
     * chaque coupure reseau, y compris pendant les tentatives de reconnexion
     * qu'il mene tout seul. Sans ecouteur, une seconde de Redis absent tuerait
     * un serveur qui, autrement, aurait repris sa connexion sans que personne
     * ne s'en apercoive.
     */
    this.client.on('error', (cause: unknown) => {
      this.logger.error(
        cause instanceof Error ? cause : new Error(String(cause)),
        undefined,
        'RedisService',
      );
    });
  }

  /**
   * Ouvre la connexion, ou empeche le demarrage.
   *
   * Sans Redis, la file d'attente ne fonctionne pas : un serveur qui demarre
   * quand meme accepterait des `queue:join` qu'il ne pourrait jamais honorer,
   * et les joueurs attendraient devant un ecran de recherche muet. Mieux vaut
   * un demarrage bruyant qu'un matchmaking silencieusement mort.
   */
  async onModuleInit(): Promise<void> {
    await this.client.connect();
    this.logger.log('connexion Redis etablie', 'RedisService');
  }

  async onModuleDestroy(): Promise<void> {
    // `close` attend les commandes en cours ; `destroy` les rejetterait.
    if (this.client.isOpen) await this.client.close();
  }
}
