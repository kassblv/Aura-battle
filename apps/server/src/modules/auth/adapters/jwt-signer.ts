import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import type { ServerConfig } from '../../../shared/config.js';
import type { AccessTokenSigner } from '../domain/ports.js';

/** Contenu d'un jeton d'acces. Volontairement minimal. */
export interface AccessTokenPayload {
  /** Sujet : l'identifiant du joueur. */
  readonly sub: string;
}

/**
 * Signature des jetons d'acces.
 *
 * Le jeton ne porte que l'identifiant du joueur. Pas de nom, pas de ligue, pas
 * d'inventaire : un JWT n'est pas chiffre, seulement signe — tout ce qu'on y
 * met est lisible par n'importe qui, et devient faux des que la donnee change.
 */
@Injectable()
export class JwtAccessTokenSigner implements AccessTokenSigner {
  constructor(
    private readonly jwt: JwtService,
    private readonly config: ServerConfig,
  ) {}

  sign(payload: { playerId: string }): Promise<string> {
    return this.jwt.signAsync({ sub: payload.playerId } satisfies AccessTokenPayload, {
      expiresIn: this.config.jwtAccessTtl,
    });
  }
}
