import {
  BadRequestException,
  Body,
  Controller,
  Headers,
  HttpCode,
  HttpException,
  HttpStatus,
  Inject,
  Post,
  UnauthorizedException,
} from '@nestjs/common';
import { productEventSchema } from '@aura/protocol';
import { SystemClock } from '../../../shared/clock.js';
import { readBearer } from '../../auth/application/bearer.js';
import type { AccessTokenVerifier } from '../../auth/application/socket-auth.js';
import type { Clock } from '../domain/ports.js';
import { EventsRateLimit } from '../application/events-rate-limit.js';
import { ProductEventsService } from '../application/product-events.js';

/**
 * `POST /events` : ce que seul le client sait (protocole 2.5.0).
 *
 * Authentifiee et limitee en debit PAR JOUEUR, apres l'authentification et
 * avant tout le reste — un corps invalide coute un jeton comme les autres,
 * comme sur les routes du passe de saison.
 *
 * **`204` dans tous les cas acceptes**, siege absent compris : repondre
 * autrement quand le joueur n'etait pas au match apprendrait a qui sonde
 * quels identifiants de match existent et qui y jouait.
 */
@Controller('events')
export class EventsController {
  // Jetons explicites : esbuild n'emet pas `design:paramtypes` (voir CLAUDE.md).
  constructor(
    @Inject(ProductEventsService) private readonly events: ProductEventsService,
    @Inject('ACCESS_TOKEN_VERIFIER') private readonly verifier: AccessTokenVerifier,
    @Inject(EventsRateLimit) private readonly rateLimit: EventsRateLimit,
    @Inject(SystemClock) private readonly clock: Clock,
  ) {}

  @Post()
  @HttpCode(HttpStatus.NO_CONTENT)
  async report(
    @Headers('authorization') authorization: string | undefined,
    @Body() body: unknown,
  ): Promise<void> {
    const playerId = await this.requirePlayer(authorization);
    if (!this.rateLimit.allow(playerId, this.clock.now().getTime())) {
      throw new HttpException(
        { code: 'RATE_LIMITED', message: 'RATE_LIMITED' },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    const parsed = productEventSchema.safeParse(body);
    if (!parsed.success) {
      // Le code seulement : un message de zod recopierait la valeur refusee.
      throw new BadRequestException({ code: 'INVALID_PAYLOAD', message: 'INVALID_PAYLOAD' });
    }
    await this.events.report(playerId, parsed.data);
  }

  private async requirePlayer(authorization: string | undefined): Promise<string> {
    const token = readBearer(authorization);
    if (token === null) {
      throw new UnauthorizedException({ code: 'UNAUTHORIZED', message: 'jeton absent' });
    }
    try {
      return (await this.verifier.verify(token)).sub;
    } catch {
      // Signature, expiration, jeton forge : meme reponse pour les trois.
      throw new UnauthorizedException({ code: 'UNAUTHORIZED', message: 'session invalide' });
    }
  }
}
