import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { SystemClock } from '../../shared/clock.js';
import { InventoryService } from './application/inventory.js';
import { InventoryRateLimit } from './application/inventory-rate-limit.js';
import { InventoryController } from './adapters/inventory.controller.js';
import { PrismaInventoryRepository } from './adapters/prisma-inventory.repository.js';
import { INVENTORY_CHANGES, type InventoryChanges } from './domain/ports.js';
import { MatchModule } from '../match/match.module.js';

/**
 * L'inventaire (jalon M8) : ce qu'on possede, ce qu'on achete, ce qu'on porte.
 *
 * Il importe `AuthModule` pour deux choses seulement — le verificateur de
 * jetons et `PrismaService`. Le verificateur vient de la, et pas d'ici : deux
 * verificateurs seraient deux endroits ou la validite d'un jeton pourrait
 * diverger, ce qui est exactement le genre d'ecart qu'on ne remarque qu'une
 * fois quelqu'un connecte avec un jeton qu'un autre module refuse.
 */
@Module({
  // `MatchModule` pour une seule chose : l'ecoute des changements, qu'il
  // realise. L'inventaire ne connait que le port — il previent, sans savoir qui.
  imports: [AuthModule, MatchModule],
  controllers: [InventoryController],
  providers: [
    PrismaInventoryRepository,
    {
      provide: InventoryService,
      inject: [PrismaInventoryRepository, SystemClock, INVENTORY_CHANGES],
      useFactory: (
        inventory: PrismaInventoryRepository,
        clock: SystemClock,
        changes: InventoryChanges,
      ) => new InventoryService({ inventory, clock, changes }),
    },
    SystemClock,
    // Un seul exemplaire pour le processus : les seaux vivent en memoire, et
    // deux exemplaires doubleraient la limite.
    { provide: InventoryRateLimit, useFactory: () => new InventoryRateLimit() },
  ],
})
export class InventoryModule {}
