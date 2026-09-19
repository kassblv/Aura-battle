import { Global, Module } from '@nestjs/common';
import { CONFIG, type ServerConfig } from './config.js';
import { createLogger, PinoLoggerService } from './logger.js';

/**
 * Journalisation, disponible partout.
 *
 * Un seul logger racine pour tout le serveur : c'est ce qui garantit qu'aucun
 * chemin ne contourne la redaction des secrets et de l'etat de match.
 */
@Global()
@Module({
  providers: [
    {
      provide: PinoLoggerService,
      inject: [CONFIG],
      useFactory: (config: ServerConfig) => new PinoLoggerService(createLogger(config)),
    },
  ],
  exports: [PinoLoggerService],
})
export class LoggerModule {}
