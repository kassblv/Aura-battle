import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { PaymentsController } from './adapters/payments.controller.js';
import { PrismaTokenLedger } from './adapters/prisma-token-ledger.js';
import { TOKEN_LEDGER } from './domain/ports.js';

/**
 * L'achat de jetons en argent reel, par RevenueCat (ADR 0016).
 *
 * Aucun lien avec l'inventaire ni le match : le module ne fait que crediter
 * `hardCurrency`, que la boutique relit comme n'importe quel solde.
 */
@Module({
  // `PrismaService` vient d'AuthModule, comme pour l'inventaire et les defis.
  imports: [AuthModule],
  controllers: [PaymentsController],
  providers: [PrismaTokenLedger, { provide: TOKEN_LEDGER, useExisting: PrismaTokenLedger }],
})
export class PaymentsModule {}
