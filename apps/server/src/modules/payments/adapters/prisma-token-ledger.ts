import { Inject, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PURCHASE_TRANSACTION } from '../../../shared/database-timeouts.js';
import { PrismaService } from '../../../shared/prisma.service.js';
import type { GrantOutcome, TokenCredit, TokenLedger } from '../domain/ports.js';

/**
 * Le credit des jetons payes (ADR 0016).
 *
 * L'achat s'inscrit PUIS le joueur est credite, dans la meme transaction : un
 * renvoi du meme evenement bute sur la cle primaire (`P2002`) avant tout
 * credit, et un credit ne peut pas exister sans sa ligne d'achat.
 */
@Injectable()
export class PrismaTokenLedger implements TokenLedger {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async grant(credit: TokenCredit): Promise<GrantOutcome> {
    try {
      await this.prisma.$transaction(async (tx) => {
        await tx.tokenPurchase.create({ data: credit });
        await tx.player.update({
          where: { id: credit.playerId },
          data: { hardCurrency: { increment: credit.tokens } },
          select: { id: true },
        });
      }, PURCHASE_TRANSACTION);
      return 'granted';
    } catch (cause) {
      if (cause instanceof Prisma.PrismaClientKnownRequestError) {
        if (cause.code === 'P2002') return 'duplicate';
        // Cle etrangere (P2003) ou ligne absente (P2025) : pas de tel joueur.
        if (cause.code === 'P2003' || cause.code === 'P2025') return 'unknown_player';
      }
      throw cause;
    }
  }
}
