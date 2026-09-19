import { Inject, Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import type { AccessTokenVerifier, VerifiedToken } from '../application/socket-auth.js';

/**
 * Verification d'un jeton d'acces par signature.
 *
 * `verifyAsync` leve des que la signature ou l'expiration ne convient pas :
 * c'est l'appelant qui decide quoi en dire au client, et il n'en dit rien de
 * precis (voir `SocketAuthenticator`).
 */
@Injectable()
export class JwtAccessTokenVerifier implements AccessTokenVerifier {
  constructor(@Inject(JwtService) private readonly jwt: JwtService) {}

  async verify(token: string): Promise<VerifiedToken> {
    const payload = await this.jwt.verifyAsync<{ sub?: unknown }>(token);
    return { sub: typeof payload.sub === 'string' ? payload.sub : '' };
  }
}
