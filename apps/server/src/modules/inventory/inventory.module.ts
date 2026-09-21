import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { SystemClock } from '../../shared/clock.js';
import { InventoryService } from './application/inventory.js';
import { InventoryController } from './adapters/inventory.controller.js';
import { PrismaInventoryRepository } from './adapters/prisma-inventory.repository.js';

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
  imports: [AuthModule],
  controllers: [InventoryController],
  providers: [
    PrismaInventoryRepository,
    {
      provide: InventoryService,
      inject: [PrismaInventoryRepository, SystemClock],
      useFactory: (inventory: PrismaInventoryRepository, clock: SystemClock) =>
        new InventoryService({ inventory, clock }),
    },
    SystemClock,
  ],
})
export class InventoryModule {}
