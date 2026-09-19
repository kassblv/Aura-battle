import { Module } from '@nestjs/common';
import { JwtModule, JwtService } from '@nestjs/jwt';
import { CONFIG, type ServerConfig } from '../../shared/config.js';
import { SystemClock } from '../../shared/clock.js';
import { PrismaService } from '../../shared/prisma.service.js';
import { AuthController } from './adapters/auth.controller.js';
import { JwtAccessTokenSigner } from './adapters/jwt-signer.js';
import { JwtAccessTokenVerifier } from './adapters/jwt-verifier.js';
import {
  PrismaPlayerRepository,
  PrismaRefreshTokenRepository,
} from './adapters/prisma-repositories.js';
import { ProfileService } from './application/profile.js';
import { SessionService } from './application/session.js';
import { SocketAuthenticator } from './application/socket-auth.js';

/**
 * Module d'authentification (architecture hexagonale, docs/02).
 *
 * C'est ici, et seulement ici, que le domaine rencontre l'infrastructure :
 * `SessionService` recoit des ports, ce module decide que ces ports sont
 * Prisma, le JWT de Nest et l'horloge systeme. Remplacer Prisma demanderait de
 * ne toucher qu'a ce fichier et aux adaptateurs.
 */
@Module({
  imports: [
    JwtModule.registerAsync({
      inject: [CONFIG],
      useFactory: (config: ServerConfig) => ({
        secret: config.jwtSecret,
        signOptions: { algorithm: 'HS256' as const },
      }),
    }),
  ],
  controllers: [AuthController],
  providers: [
    SystemClock,
    JwtAccessTokenVerifier,
    {
      provide: SocketAuthenticator,
      inject: [JwtAccessTokenVerifier],
      useFactory: (verifier: JwtAccessTokenVerifier) => new SocketAuthenticator(verifier),
    },
    {
      provide: PrismaService,
      inject: [CONFIG],
      useFactory: (config: ServerConfig) => new PrismaService(config),
    },
    PrismaPlayerRepository,
    PrismaRefreshTokenRepository,
    {
      provide: ProfileService,
      inject: [PrismaPlayerRepository],
      useFactory: (players: PrismaPlayerRepository) => new ProfileService({ players }),
    },
    // Jeton nomme : le controleur depend du **port**, pas de l'implementation
    // JWT. Remplacer la verification ne demanderait de toucher qu'ici.
    {
      provide: 'ACCESS_TOKEN_VERIFIER',
      inject: [JwtAccessTokenVerifier],
      useFactory: (verifier: JwtAccessTokenVerifier) => verifier,
    },
    {
      provide: JwtAccessTokenSigner,
      inject: [JwtService, CONFIG],
      useFactory: (jwt: JwtService, config: ServerConfig) => new JwtAccessTokenSigner(jwt, config),
    },
    {
      provide: SessionService,
      inject: [
        PrismaPlayerRepository,
        PrismaRefreshTokenRepository,
        JwtAccessTokenSigner,
        SystemClock,
        CONFIG,
      ],
      useFactory: (
        players: PrismaPlayerRepository,
        refreshTokens: PrismaRefreshTokenRepository,
        signer: JwtAccessTokenSigner,
        clock: SystemClock,
        config: ServerConfig,
      ) =>
        new SessionService({
          players,
          refreshTokens,
          signer,
          clock,
          accessTtlSeconds: config.jwtAccessTtl,
          refreshTtlSeconds: config.jwtRefreshTtl,
        }),
    },
  ],
  exports: [SessionService, SocketAuthenticator, PrismaService],
})
export class AuthModule {}
