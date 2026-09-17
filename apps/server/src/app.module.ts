import { Module } from '@nestjs/common';
import { AuthModule } from './modules/auth/auth.module.js';
import { HealthModule } from './modules/health/health.module.js';
import { ConfigModule } from './shared/config.module.js';

/**
 * Racine de l'application (docs/02-architecture.md).
 *
 * La configuration est chargee et validee une seule fois ici, puis injectee.
 * Aucun `process.env` ailleurs dans le code : un demarrage avec une variable
 * manquante echoue immediatement, au lieu de produire un serveur a moitie
 * configure qui tombera en pleine partie.
 */
@Module({
  imports: [ConfigModule, HealthModule, AuthModule],
})
export class AppModule {}
