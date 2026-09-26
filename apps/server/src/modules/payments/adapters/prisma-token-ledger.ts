import { Inject, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PURCHASE_TRANSACTION } from '../../../shared/database-timeouts.js';
import { PrismaService } from '../../../shared/prisma.service.js';
import type {
  GrantOutcome,
  RefundOutcome,
  TokenCredit,
  TokenLedger,
  TokenRefund,
  UnattributedPurchase,
} from '../domain/ports.js';

const isKnown = (cause: unknown, code: string): boolean =>
  cause instanceof Prisma.PrismaClientKnownRequestError && cause.code === code;

/**
 * Le grand livre des jetons payes (ADR 0016).
 *
 * L'achat s'inscrit PUIS le joueur est credite, dans la meme transaction : un
 * renvoi — du meme evenement ou d'un autre evenement de la meme transaction du
 * store — bute sur une contrainte d'unicite (`P2002`) avant tout credit.
 */
@Injectable()
export class PrismaTokenLedger implements TokenLedger {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async grant(credit: TokenCredit): Promise<GrantOutcome> {
    try {
      await this.prisma.$transaction(async (tx) => {
        await tx.tokenPurchase.create({
          data: { ...credit, appUserId: credit.playerId, status: 'CREDITED' },
        });
        await tx.player.update({
          where: { id: credit.playerId },
          data: { hardCurrency: { increment: credit.tokens } },
          select: { id: true },
        });
      }, PURCHASE_TRANSACTION);
      return 'granted';
    } catch (cause) {
      if (isKnown(cause, 'P2002')) return 'duplicate';
      // Cle etrangere (P2003) ou ligne absente (P2025) : pas de tel joueur.
      // L'achat est paye : il s'inscrit pour le support, sans credit.
      if (isKnown(cause, 'P2003') || isKnown(cause, 'P2025')) {
        const recorded = await this.recordUnattributed({
          eventId: credit.eventId,
          transactionId: credit.transactionId,
          reason: 'UNKNOWN_PLAYER',
          appUserId: credit.playerId,
          productId: credit.productId,
          store: credit.store,
          environment: credit.environment,
        });
        return recorded === 'duplicate' ? 'duplicate' : 'unattributed';
      }
      throw cause;
    }
  }

  async recordUnattributed(purchase: UnattributedPurchase): Promise<'recorded' | 'duplicate'> {
    try {
      await this.prisma.tokenPurchase.create({
        data: { ...purchase, playerId: null, tokens: 0, status: 'UNATTRIBUTED' },
      });
      return 'recorded';
    } catch (cause) {
      if (isKnown(cause, 'P2002')) return 'duplicate';
      throw cause;
    }
  }

  /**
   * Reprend les jetons d'un achat rembourse : ce qui reste en bourse, jamais
   * en dessous de zero. Ce qui avait ete depense est rendu (`owed`) pour que
   * le support tranche.
   *
   * La ligne du joueur est verrouillee avant la reprise : un achat simultane
   * en boutique ne peut pas passer entre la lecture du solde et son debit, et
   * un renvoi du meme remboursement, serialise derriere, voit qu'il est fait.
   */
  async refund(refund: TokenRefund): Promise<RefundOutcome> {
    return this.prisma.$transaction(async (tx) => {
      const key = { store: refund.store, transactionId: refund.transactionId };
      const found = await tx.tokenPurchase.findUnique({ where: { store_transactionId: key } });
      if (found === null) return { kind: 'unknown' } as const;

      let balance = 0;
      if (found.playerId !== null) {
        const rows = await tx.$queryRaw<{ hardCurrency: number }[]>`
          SELECT "hardCurrency" FROM "Player" WHERE id = ${found.playerId} FOR UPDATE`;
        balance = rows[0]?.hardCurrency ?? 0;
      }

      // Relue APRES le verrou : un renvoi concurrent a pu passer entre-temps.
      const purchase = await tx.tokenPurchase.findUniqueOrThrow({
        where: { store_transactionId: key },
      });
      if (purchase.refundedAt !== null) return { kind: 'already' } as const;

      const taken = Math.min(purchase.tokens, Math.max(0, balance));
      if (purchase.playerId !== null && taken > 0) {
        await tx.player.update({
          where: { id: purchase.playerId },
          data: { hardCurrency: { decrement: taken } },
          select: { id: true },
        });
      }
      await tx.tokenPurchase.update({
        where: { store_transactionId: key },
        data: { refundedAt: new Date(), refundEventId: refund.eventId, refundedTokens: taken },
      });
      return { kind: 'refunded', taken, owed: purchase.tokens - taken } as const;
    }, PURCHASE_TRANSACTION);
  }
}
