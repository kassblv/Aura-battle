import { Module } from '@nestjs/common';
import { CONFIG, type ServerConfig } from '../../shared/config.js';
import { PinoLoggerService } from '../../shared/logger.js';
import { AuthModule } from '../auth/auth.module.js';
import { PrismaFlagAssignmentStore } from './adapters/prisma-flag-assignment.store.js';
import { PrismaFlagSettingsStore } from './adapters/prisma-flag-settings.store.js';
import { FeatureFlags } from './application/feature-flags.js';

/**
 * Interrupteurs d'experience (spec 2026-09-26 « Bulle d'intention en test A/B »).
 *
 * `AuthModule` pour `PrismaService`, comme les indicateurs. `FeatureFlags` est
 * exporte : l'ouverture des matchs l'interroge, le panneau en lit et en ecrit
 * les reglages (`FlagSetting`, ADR 0018). Nest appelle ses crochets de cycle
 * de vie : premiere lecture au demarrage, relecture toutes les trente secondes.
 */
@Module({
  imports: [AuthModule],
  providers: [
    PrismaFlagAssignmentStore,
    PrismaFlagSettingsStore,
    {
      provide: FeatureFlags,
      inject: [CONFIG, PrismaFlagAssignmentStore, PrismaFlagSettingsStore, PinoLoggerService],
      useFactory: (
        config: ServerConfig,
        store: PrismaFlagAssignmentStore,
        settings: PrismaFlagSettingsStore,
        logger: PinoLoggerService,
      ) =>
        new FeatureFlags({
          // Valeurs de depart seulement : la base fait foi des qu'elle a une ligne.
          rollouts: config.flagRollouts,
          clock: { now: () => Date.now() },
          store,
          settings,
          log: { warn: (message: string) => logger.warn(message, 'FeatureFlags') },
        }),
    },
  ],
  exports: [FeatureFlags],
})
export class FlagsModule {}
