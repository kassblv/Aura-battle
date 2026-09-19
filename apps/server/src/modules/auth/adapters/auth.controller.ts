import {
  BadRequestException,
  Body,
  Controller,
  Headers,
  Inject,
  Patch,
  Post,
  UnauthorizedException,
} from '@nestjs/common';
import {
  parseAuthDeviceRequest,
  parseAuthRefreshRequest,
  parseAuthRenameRequest,
  type SessionResponse,
} from '@aura/protocol';
import { readBearer } from '../application/bearer.js';
import type { AccessTokenVerifier } from '../application/socket-auth.js';
import { ProfileError, ProfileService } from '../application/profile.js';
import { SessionError, SessionService } from '../application/session.js';

/** Ce que la route de profil rend : le joueur, tel qu'il s'appelle desormais. */
export interface ProfileResponse {
  readonly id: string;
  readonly displayName: string;
}

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
  constructor(
    @Inject(SessionService) private readonly sessions: SessionService,
    @Inject(ProfileService) private readonly profiles: ProfileService,
    @Inject('ACCESS_TOKEN_VERIFIER') private readonly verifier: AccessTokenVerifier,
  ) {}

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
   * Change le nom affiche.
   *
   * Premiere route authentifiee du serveur. Le jeton est lu et verifie ici
   * plutot que par une garde globale : il n'y a qu'une route protegee, et une
   * garde posee sur tout le controleur fermerait aussi `device` et `refresh`,
   * qui sont precisement les deux routes qu'on appelle **sans** jeton.
   */
  @Patch('profile')
  async rename(
    @Headers('authorization') authorization: string | undefined,
    @Body() body: unknown,
  ): Promise<ProfileResponse> {
    const token = readBearer(authorization);
    if (token === null) {
      throw new UnauthorizedException({ code: 'UNAUTHORIZED', message: 'jeton absent' });
    }

    const parsed = parseAuthRenameRequest(body);
    if (!parsed.success) {
      throw new BadRequestException({ code: 'INVALID_PAYLOAD', message: parsed.error });
    }

    let playerId: string;
    try {
      playerId = (await this.verifier.verify(token)).sub;
    } catch {
      // Signature, expiration, jeton forge : la reponse est la meme. Le client
      // n'a pas a apprendre laquelle de ces trois raisons s'applique.
      throw new UnauthorizedException({ code: 'UNAUTHORIZED', message: 'session invalide' });
    }

    try {
      return await this.profiles.rename(playerId, parsed.data.displayName);
    } catch (cause) {
      if (cause instanceof ProfileError) {
        if (cause.reason === 'INVALID_DISPLAY_NAME') {
          throw new BadRequestException({ code: 'INVALID_PAYLOAD', message: 'nom invalide' });
        }
        throw new UnauthorizedException({ code: 'UNAUTHORIZED', message: 'session invalide' });
      }
      throw cause;
    }
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
