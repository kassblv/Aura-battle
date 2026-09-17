import { Module } from '@nestjs/common';
import { JwtModule, JwtService } from '@nestjs/jwt';
import { CONFIG, type ServerConfig } from '../../shared/config.js';
import { SystemClock } from '../../shared/clock.js';
import { PrismaService } from '../../shared/prisma.service.js';
import { AuthController } from './adapters/auth.controller.js';
import { JwtAccessTokenSigner } from './adapters/jwt-signer.js';
import {
  PrismaPlayerRepository,
  PrismaRefreshTokenRepository,
} from './adapters/prisma-repositories.js';
import { SessionService } from './application/session.js';

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
    {
      provide: PrismaService,
      inject: [CONFIG],
      useFactory: (config: ServerConfig) => new PrismaService(config),
    },
    PrismaPlayerRepository,
    PrismaRefreshTokenRepository,
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
  exports: [SessionService, PrismaService],
})
export class AuthModule {}
