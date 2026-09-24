import { Module } from '@nestjs/common';
import { JwtModule, JwtService } from '@nestjs/jwt';
import { CONFIG, type ServerConfig } from '../../shared/config.js';
import { SystemClock } from '../../shared/clock.js';
import { PinoLoggerService } from '../../shared/logger.js';
import { PrismaService } from '../../shared/prisma.service.js';
import { RedisModule } from '../../shared/redis.module.js';
import { RedisService } from '../../shared/redis.js';
import { Argon2PasswordHasher } from './adapters/argon2-password-hasher.js';
import { AuthController } from './adapters/auth.controller.js';
import { JwtAccessTokenSigner } from './adapters/jwt-signer.js';
import { JwtAccessTokenVerifier } from './adapters/jwt-verifier.js';
import {
  PrismaPlayerRepository,
  PrismaRefreshTokenRepository,
} from './adapters/prisma-repositories.js';
import { RedisAttemptLimiter } from './adapters/redis-attempt-limiter.js';
import { EmailAuthService, LIMITS } from './application/email.js';
import { ProfileService } from './application/profile.js';
import { RecoveryService } from './application/recovery.js';
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
    // La limite de tentatives de connexion vit dans Redis (ADR 0013).
    RedisModule,
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
    {
      provide: RecoveryService,
      inject: [PrismaPlayerRepository],
      useFactory: (players: PrismaPlayerRepository) => new RecoveryService({ players }),
    },
    {
      provide: EmailAuthService,
      inject: [PrismaPlayerRepository, RecoveryService, RedisService, PinoLoggerService],
      useFactory: (
        players: PrismaPlayerRepository,
        recovery: RecoveryService,
        redis: RedisService,
        logger: PinoLoggerService,
      ) =>
        new EmailAuthService({
          identities: players,
          hasher: new Argon2PasswordHasher(),
          limiter: new RedisAttemptLimiter(redis.client, LIMITS.windowMs),
          recovery,
          log: { warn: (message) => logger.warn(message, 'EmailAuthService') },
        }),
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
  // `ACCESS_TOKEN_VERIFIER` sort d'ici : l'inventaire authentifie ses routes
  // avec le MEME verificateur. Deux verificateurs seraient deux endroits ou
  // la validite d'un jeton pourrait diverger.
  exports: [SessionService, SocketAuthenticator, PrismaService, 'ACCESS_TOKEN_VERIFIER'],
})
export class AuthModule {}
