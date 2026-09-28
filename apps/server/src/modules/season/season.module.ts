import { PinoLoggerService } from '../../shared/logger.js';
import { Module } from '@nestjs/common';
import { SystemClock } from '../../shared/clock.js';
import { AuthModule } from '../auth/auth.module.js';
import { PrismaInventoryRepository } from '../inventory/adapters/prisma-inventory.repository.js';
import { INVENTORY_CHANGES, type InventoryChanges } from '../inventory/domain/ports.js';
import { InventoryStoreModule } from '../inventory/inventory-store.module.js';
import { MatchModule } from '../match/match.module.js';
import { PrismaSeasonRepository } from './adapters/prisma-season.repository.js';
import { SeasonController } from './adapters/season.controller.js';
import { SeasonService } from './application/season.js';
import { SeasonRateLimit } from './application/season-rate-limit.js';

/**
 * Le passe de saison (docs/01, passe de saison).
 *
 * `AuthModule` pour le verificateur de jetons et `PrismaService`, comme
 * l'inventaire et les defis. `InventoryStoreModule` pour la bourse, les
 * possessions et le catalogue — le depot partage, pas un second exemplaire.
 * `MatchModule` pour une seule chose : prevenir le match qu'un cosmetique vient
 * d'etre accorde, par le meme port que la boutique.
 */
@Module({
  imports: [AuthModule, InventoryStoreModule, MatchModule],
  controllers: [SeasonController],
  providers: [
    PrismaSeasonRepository,
    {
      provide: SeasonService,
      inject: [
        PrismaSeasonRepository,
        PrismaInventoryRepository,
        SystemClock,
        INVENTORY_CHANGES,
        PinoLoggerService,
      ],
      useFactory: (
        seasons: PrismaSeasonRepository,
        inventory: PrismaInventoryRepository,
        clock: SystemClock,
        changes: InventoryChanges,
        logger: PinoLoggerService,
      ) =>
        new SeasonService({
          seasons,
          inventory,
          clock,
          changes,
          warn: (message) => {
            logger.warn(message);
          },
        }),
    },
    SystemClock,
    // Un seul exemplaire pour le processus : les seaux vivent en memoire.
    { provide: SeasonRateLimit, useFactory: () => new SeasonRateLimit() },
  ],
})
export class SeasonModule {}
