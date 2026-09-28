import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  ForbiddenException,
  Get,
  Headers,
  HttpException,
  HttpStatus,
  Inject,
  NotFoundException,
  Post,
  UnauthorizedException,
} from '@nestjs/common';
import { parseSeasonClaimRequest, type SeasonState } from '@aura/protocol';
import { readBearer } from '../../auth/application/bearer.js';
import type { AccessTokenVerifier } from '../../auth/application/socket-auth.js';
import { SystemClock } from '../../../shared/clock.js';
import type { Clock, SeasonFailure } from '../domain/ports.js';
import { SeasonError, SeasonService } from '../application/season.js';
import { SeasonRateLimit, type SeasonRoute } from '../application/season-rate-limit.js';

/**
 * Routes du passe de saison (docs/03, protocole 2.3.0).
 *
 * En HTTP, comme l'inventaire et les defis : le passe se consulte hors match.
 * Toutes authentifiees et limitees en debit PAR JOUEUR, apres
 * l'authentification et avant tout le reste — un corps invalide coute un
 * jeton comme les autres.
 *
 * Aucune route n'ecrit d'XP : elle s'obtient en JOUANT, creditee a la fin de
 * chaque match. Une reclamation ne porte que le palier et la piste, jamais ce
 * qu'on y gagne (regle d'or n°1).
 */

/** Ce que chaque refus vaut en HTTP. */
const STATUS: Readonly<Record<SeasonFailure, 'not-found' | 'conflict' | 'forbidden'>> =
  Object.freeze({
    NO_SEASON: 'not-found',
    UNKNOWN_TIER: 'not-found',
    // 409 : la demande etait legitime, elle arrive en second.
    ALREADY_CLAIMED: 'conflict',
    ALREADY_PREMIUM: 'conflict',
    TIER_LOCKED: 'forbidden',
    PREMIUM_REQUIRED: 'forbidden',
    INSUFFICIENT_FUNDS: 'forbidden',
  });

@Controller('season')
export class SeasonController {
  // Jetons explicites : esbuild n'emet pas `design:paramtypes`.
  constructor(
    @Inject(SeasonService) private readonly season: SeasonService,
    @Inject('ACCESS_TOKEN_VERIFIER') private readonly verifier: AccessTokenVerifier,
    @Inject(SeasonRateLimit) private readonly rateLimit: SeasonRateLimit,
    @Inject(SystemClock) private readonly clock: Clock,
  ) {}

  @Get()
  async read(@Headers('authorization') authorization: string | undefined): Promise<SeasonState> {
    const playerId = await this.requirePlayer(authorization);
    this.throttle('read', playerId);
    return this.season.state(playerId);
  }

  @Post('claim')
  async claim(
    @Headers('authorization') authorization: string | undefined,
    @Body() body: unknown,
  ): Promise<SeasonState> {
    const playerId = await this.requirePlayer(authorization);
    this.throttle('claim', playerId);
    const parsed = parseSeasonClaimRequest(body);
    if (!parsed.success) {
      throw new BadRequestException({ code: 'INVALID_PAYLOAD', message: parsed.error });
    }
    return this.run(() => this.season.claim(playerId, parsed.data));
  }

  @Post('claim-all')
  async claimAll(
    @Headers('authorization') authorization: string | undefined,
  ): Promise<SeasonState> {
    const playerId = await this.requirePlayer(authorization);
    this.throttle('claim', playerId);
    return this.run(() => this.season.claimAll(playerId));
  }

  @Post('premium')
  async premium(@Headers('authorization') authorization: string | undefined): Promise<SeasonState> {
    const playerId = await this.requirePlayer(authorization);
    this.throttle('premium', playerId);
    return this.run(() => this.season.buyPremium(playerId));
  }

  /** Refuse en 429 le joueur qui a epuise son seau ; le temps est celui du serveur. */
  private throttle(route: SeasonRoute, playerId: string): void {
    if (this.rateLimit.allow(route, playerId, this.clock.now().getTime())) return;
    throw new HttpException(
      { code: 'RATE_LIMITED', message: 'RATE_LIMITED' },
      HttpStatus.TOO_MANY_REQUESTS,
    );
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

  /** Traduit un refus du domaine ; le code, jamais une phrase — le client choisit les mots. */
  private async run(action: () => Promise<SeasonState>): Promise<SeasonState> {
    try {
      return await action();
    } catch (cause) {
      if (!(cause instanceof SeasonError)) throw cause;
      const payload = { code: cause.reason, message: cause.reason };
      switch (STATUS[cause.reason]) {
        case 'not-found':
          throw new NotFoundException(payload);
        case 'conflict':
          throw new ConflictException(payload);
        default:
          throw new ForbiddenException(payload);
      }
    }
  }
}
