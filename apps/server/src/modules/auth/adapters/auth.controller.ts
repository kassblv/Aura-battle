import {
  BadRequestException,
  Body,
  Controller,
  Inject,
  Post,
  UnauthorizedException,
} from '@nestjs/common';
import {
  parseAuthDeviceRequest,
  parseAuthRefreshRequest,
  type SessionResponse,
} from '@aura/protocol';
import { SessionError, SessionService } from '../application/session.js';

/**
 * Routes d'authentification (docs/03, jalon M3).
 *
 * Deux routes, aucune inscription. Le corps des requetes est valide par les
 * schemas de `@aura/protocol` : la meme definition sert au client et au
 * serveur, donc les deux ne peuvent pas diverger.
 */
@Controller('auth')
export class AuthController {
  /**
   * `@Inject` explicite, et non l'injection implicite par type.
   *
   * Nest deduit normalement le type d'un parametre de constructeur grace a la
   * metadonnee `design:paramtypes`, emise par `emitDecoratorMetadata`. Or esbuild
   * — donc `tsx`, qui fait tourner ce serveur — ne l'emet pas. Sans elle, Nest
   * ne sait pas quoi injecter et passe `undefined`, sans la moindre erreur au
   * demarrage : la panne n'apparait qu'au premier appel. Nommer le jeton
   * supprime le probleme et rend le cablage lisible.
   */
  constructor(@Inject(SessionService) private readonly sessions: SessionService) {}

  /**
   * Ouvre une session a partir d'un secret d'appareil.
   * Cree le joueur au premier appel, le retrouve ensuite.
   */
  @Post('device')
  async device(@Body() body: unknown): Promise<SessionResponse> {
    const parsed = parseAuthDeviceRequest(body);
    if (!parsed.success) {
      throw new BadRequestException({ code: 'INVALID_PAYLOAD', message: parsed.error });
    }
    return this.toResponse(() => this.sessions.authenticateDevice(parsed.data.deviceSecret));
  }

  /** Echange un jeton de rafraichissement contre un nouveau couple. */
  @Post('refresh')
  async refresh(@Body() body: unknown): Promise<SessionResponse> {
    const parsed = parseAuthRefreshRequest(body);
    if (!parsed.success) {
      throw new BadRequestException({ code: 'INVALID_PAYLOAD', message: parsed.error });
    }
    return this.toResponse(() => this.sessions.refresh(parsed.data.refreshToken));
  }

  /**
   * Traduit une erreur de session en reponse HTTP.
   *
   * Le message renvoye ne distingue pas « jeton inconnu » de « jeton rejoue » :
   * un attaquant n'a pas a apprendre, depuis nos reponses, si le jeton qu'il
   * essaie a deja existe. Le detail reste cote serveur, dans le journal.
   */
  private async toResponse(run: () => Promise<SessionResponse>): Promise<SessionResponse> {
    try {
      return await run();
    } catch (cause) {
      if (cause instanceof SessionError) {
        if (cause.reason === 'INVALID_DEVICE_SECRET') {
          throw new BadRequestException({
            code: 'INVALID_PAYLOAD',
            message: 'secret d appareil invalide',
          });
        }
        throw new UnauthorizedException({
          code: 'UNAUTHORIZED',
          message: 'session expiree ou invalide',
        });
      }
      throw cause;
    }
  }
}
