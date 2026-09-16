import { Module } from '@nestjs/common';
import { LoggerModule } from 'nestjs-pino';
import { HealthModule } from './modules/health/health.module.js';
import { CONFIG, loadConfig } from './shared/config.js';
import { loggerOptions } from './shared/logger.js';

/**
 * Racine de l'application (docs/02-architecture.md).
 *
 * La configuration est chargee et validee une seule fois ici, puis injectee.
 * Aucun `process.env` ailleurs dans le code : un demarrage avec une variable
 * manquante echoue immediatement, au lieu de produire un serveur a moitie
 * configure qui tombera en pleine partie.
 */
@Module({
  imports: [
    LoggerModule.forRootAsync({
      useFactory: () => loggerOptions(loadConfig(process.env)),
    }),
    HealthModule,
  ],
  providers: [{ provide: CONFIG, useFactory: () => loadConfig(process.env) }],
  exports: [CONFIG],
})
export class AppModule {}
