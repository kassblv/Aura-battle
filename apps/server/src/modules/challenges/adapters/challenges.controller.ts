import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Get,
  Headers,
  Inject,
  NotFoundException,
  Post,
  UnauthorizedException,
} from '@nestjs/common';
import { readBearer } from '../../auth/application/bearer.js';
import type { AccessTokenVerifier } from '../../auth/application/socket-auth.js';
import { ChallengeService, type ChallengeView } from '../application/challenges.js';

/**
 * Routes des defis quotidiens (docs/01 §11).
 *
 * En HTTP, comme l'inventaire : on consulte ses defis hors match, et forcer
 * une connexion temps reel pour lire trois lignes serait absurde.
 *
 * Aucune route n'ecrit de progression. La progression s'obtient en JOUANT, et
 * le serveur la calcule a la fin de chaque manche : une route qui accepterait
 * « j'ai fait trois parfaits » rendrait le defi declaratif, ce que le design
 * refuse explicitement — « valides cote serveur ».
 */

export interface ChallengeClaimResponse {
  readonly reward: number;
  readonly challenges: readonly ChallengeView[];
}

@Controller('challenges')
export class ChallengesController {
  // Jetons explicites : esbuild n'emet pas `design:paramtypes`.
  constructor(
    @Inject(ChallengeService) private readonly challenges: ChallengeService,
    @Inject('ACCESS_TOKEN_VERIFIER') private readonly verifier: AccessTokenVerifier,
  ) {}

  @Get()
  async today(
    @Headers('authorization') authorization: string | undefined,
  ): Promise<{ readonly challenges: readonly ChallengeView[] }> {
    const playerId = await this.requirePlayer(authorization);
    return { challenges: await this.challenges.today(playerId) };
  }

  /**
   * Encaisse la recompense d'un defi termine.
   *
   * La requete ne porte que l'identifiant : le montant vient du catalogue,
   * jamais du client. Regle d'or n°1, appliquee a la recompense.
   */
  @Post('claim')
  async claim(
    @Headers('authorization') authorization: string | undefined,
    @Body() body: unknown,
  ): Promise<ChallengeClaimResponse> {
    const playerId = await this.requirePlayer(authorization);

    const challengeId = readChallengeId(body);
    if (challengeId === null) {
      throw new BadRequestException({ code: 'INVALID_PAYLOAD', message: 'challengeId manquant' });
    }

    const outcome = await this.challenges.claim(playerId, challengeId);
    if (outcome.status === 'unknown') {
      throw new NotFoundException({ code: 'UNKNOWN_CHALLENGE' });
    }
    if (outcome.status === 'already-claimed') {
      // 409 et non 403 : la demande etait legitime, elle arrive en second.
      throw new ConflictException({ code: 'ALREADY_CLAIMED' });
    }
    if (outcome.status === 'incomplete') {
      throw new ConflictException({ code: 'INCOMPLETE' });
    }

    return { reward: outcome.reward, challenges: await this.challenges.today(playerId) };
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

/**
 * Lit l'identifiant du corps, sans rien croire d'autre.
 *
 * Borne a 64 caracteres : un identifiant de defi en fait une trentaine, et
 * une chaine non bornee arrivant jusqu'a une requete `WHERE` est exactement
 * ce qu'on ne laisse pas passer sans regarder.
 */
function readChallengeId(body: unknown): string | null {
  if (typeof body !== 'object' || body === null) return null;
  const value = (body as { challengeId?: unknown }).challengeId;
  if (typeof value !== 'string' || value.length === 0 || value.length > 64) return null;
  return value;
}
