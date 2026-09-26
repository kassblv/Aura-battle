import { Module } from '@nestjs/common';
import { CONFIG, type ServerConfig } from '../../shared/config.js';
import { PinoLoggerService } from '../../shared/logger.js';
import { AuthModule } from '../auth/auth.module.js';
import { PrismaFlagAssignmentStore } from './adapters/prisma-flag-assignment.store.js';
import { FeatureFlags } from './application/feature-flags.js';

/**
 * Interrupteurs d'experience (spec 2026-09-26 « Bulle d'intention en test A/B »).
 *
 * `AuthModule` pour `PrismaService`, comme les indicateurs. `FeatureFlags` est
 * exporte : l'ouverture des matchs l'interroge, le panneau en lit les parts.
 */
@Module({
  imports: [AuthModule],
  providers: [
    PrismaFlagAssignmentStore,
    {
      provide: FeatureFlags,
      inject: [CONFIG, PrismaFlagAssignmentStore, PinoLoggerService],
      useFactory: (
        config: ServerConfig,
        store: PrismaFlagAssignmentStore,
        logger: PinoLoggerService,
      ) =>
        new FeatureFlags({
          rollouts: config.flagRollouts,
          clock: { now: () => Date.now() },
          store,
          log: { warn: (message: string) => logger.warn(message, 'FeatureFlags') },
        }),
    },
  ],
  exports: [FeatureFlags],
})
export class FlagsModule {}
