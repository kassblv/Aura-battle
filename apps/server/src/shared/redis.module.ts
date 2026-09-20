import { Module } from '@nestjs/common';
import { CONFIG, type ServerConfig } from './config.js';
import { PinoLoggerService } from './logger.js';
import { RedisService } from './redis.js';

/**
 * Connexion Redis partagee.
 *
 * Un seul client pour tout le serveur : la file d'attente aujourd'hui, la
 * presence, les verrous et l'adaptateur Socket.IO multi-instances demain
 * (docs/02). Ouvrir une connexion par module reviendrait a multiplier les
 * reconnexions a surveiller pour le meme service.
 *
 * Pas `@Global`, a la difference de la configuration et du journal : seuls les
 * modules qui rangent quelque chose dans Redis ont a le declarer.
 */
@Module({
  providers: [
    {
      provide: RedisService,
      inject: [CONFIG, PinoLoggerService],
      useFactory: (config: ServerConfig, logger: PinoLoggerService) =>
        new RedisService(config, logger),
    },
  ],
  exports: [RedisService],
})
export class RedisModule {}
