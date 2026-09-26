import {
  BadRequestException,
  Body,
  Controller,
  Headers,
  HttpCode,
  Inject,
  NotFoundException,
  Post,
  UnauthorizedException,
} from '@nestjs/common';
import { CONFIG, type ServerConfig } from '../../../shared/config.js';
import { constantTimeEquals } from '../../../shared/constant-time.js';
import { PinoLoggerService } from '../../../shared/logger.js';
import { TOKEN_LEDGER, type TokenLedger } from '../domain/ports.js';
import { decideWebhook } from '../domain/revenuecat.js';

const BEARER = 'Bearer ';

/**
 * Le webhook de RevenueCat : la seule porte par laquelle des jetons payes
 * entrent (ADR 0016).
 *
 * - **Fermee sans secret** (404) : ouverte, elle crediterait qui sait former
 *   une requete.
 * - **Secret compare a longueur constante**, tel que RevenueCat le recopie
 *   dans `Authorization` (avec ou sans `Bearer `).
 * - **Tout evenement valide s'acquitte en 200**, meme ignore : RevenueCat
 *   renvoie tant qu'il n'a pas de 2xx. Seule une panne de la base rend une
 *   erreur, pour qu'il renvoie plus tard.
 */
@Controller('payments')
export class PaymentsController {
  constructor(
    @Inject(CONFIG) private readonly config: ServerConfig,
    @Inject(TOKEN_LEDGER) private readonly ledger: TokenLedger,
    @Inject(PinoLoggerService) private readonly log: PinoLoggerService,
  ) {}

  @Post('revenuecat')
  @HttpCode(200)
  async revenuecat(
    @Headers('authorization') authorization: string | undefined,
    @Body() body: unknown,
  ): Promise<{ ok: true }> {
    const secret = this.config.revenuecatWebhookAuth;
    if (secret === '') throw new NotFoundException({ code: 'NOT_FOUND' });

    const header = authorization ?? '';
    const offered = header.startsWith(BEARER) ? header.slice(BEARER.length) : header;
    if (!constantTimeEquals(offered, secret)) {
      throw new UnauthorizedException({ code: 'UNAUTHORIZED' });
    }

    const decision = decideWebhook(body, { allowSandbox: this.config.revenuecatSandbox });
    switch (decision.kind) {
      case 'invalid':
        throw new BadRequestException({ code: 'INVALID_PAYLOAD' });
      case 'ignore':
        return { ok: true };
      case 'unattributed': {
        const { kind: _kind, ...purchase } = decision;
        await this.ledger.recordUnattributed(purchase);
        this.log.warn(
          `achat de jetons non attribue (${decision.reason}) : evenement ${decision.eventId}, produit ${decision.productId}`,
        );
        return { ok: true };
      }
      case 'refund': {
        const { kind: _kind, ...refund } = decision;
        const outcome = await this.ledger.refund(refund);
        if (outcome.kind === 'refunded' && outcome.owed > 0) {
          // Des jetons deja depenses : la reprise s'arrete a zero, le support tranche.
          this.log.warn(
            `remboursement de jetons : ${String(outcome.taken)} repris, ${String(outcome.owed)} deja depenses (transaction ${decision.transactionId})`,
          );
        }
        return { ok: true };
      }
      case 'credit': {
        const { kind: _kind, ...credit } = decision;
        const outcome = await this.ledger.grant(credit);
        if (outcome === 'unattributed') {
          this.log.warn(
            `achat de jetons pour un joueur inconnu, inscrit pour le support : evenement ${decision.eventId}`,
          );
        }
        return { ok: true };
      }
    }
  }
}
