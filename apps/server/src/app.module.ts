import { Module } from '@nestjs/common';
import { AuthModule } from './modules/auth/auth.module.js';
import { HealthModule } from './modules/health/health.module.js';
import { MatchModule } from './modules/match/match.module.js';
import { ConfigModule } from './shared/config.module.js';
import { LoggerModule } from './shared/logger.module.js';
import { MetricsModule } from './shared/metrics.module.js';

/**
 * Racine de l'application (docs/02-architecture.md).
 *
 * La configuration est chargee et validee une seule fois ici, puis injectee.
 * Aucun `process.env` ailleurs dans le code : un demarrage avec une variable
 * manquante echoue immediatement, au lieu de produire un serveur a moitie
 * configure qui tombera en pleine partie.
 */
@Module({
  imports: [ConfigModule, LoggerModule, MetricsModule, HealthModule, AuthModule, MatchModule],
})
export class AppModule {}
