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
import { BoundedPasswordHasher } from './adapters/bounded-password-hasher.js';
import { JwtAccessTokenSigner } from './adapters/jwt-signer.js';
import { JwtAccessTokenVerifier } from './adapters/jwt-verifier.js';
import {
  PrismaPlayerRepository,
  PrismaRefreshTokenRepository,
} from './adapters/prisma-repositories.js';
import { RedisAttemptLimiter } from './adapters/redis-attempt-limiter.js';
import { EmailAuthService, LIMITS } from './application/email.js';
import { CredentialsEvents } from './application/credentials-events.js';
import { FreshAccessTokenVerifier } from './application/fresh-token.js';
import { IpRateLimit } from './application/ip-rate-limit.js';
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
    /*
      Le verificateur partage refuse tout jeton anterieur au dernier
      changement de mot de passe (ADR 0013). Le handshake Socket.IO et toutes
      les routes authentifiees — celles de l'inventaire et des defis comprises
      — passent par lui : aucune ne peut oublier le controle.
    */
    {
      provide: FreshAccessTokenVerifier,
      inject: [JwtAccessTokenVerifier, PrismaPlayerRepository],
      useFactory: (verifier: JwtAccessTokenVerifier, players: PrismaPlayerRepository) =>
        new FreshAccessTokenVerifier(verifier, players),
    },
    {
      provide: SocketAuthenticator,
      inject: [FreshAccessTokenVerifier],
      useFactory: (verifier: FreshAccessTokenVerifier) => new SocketAuthenticator(verifier),
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
    CredentialsEvents,
    {
      provide: IpRateLimit,
      inject: [RedisService, CONFIG],
      useFactory: (redis: RedisService, config: ServerConfig) =>
        new IpRateLimit(
          new RedisAttemptLimiter(redis.client, LIMITS.windowMs),
          config.authRateLimit,
        ),
    },
    {
      provide: EmailAuthService,
      inject: [
        PrismaPlayerRepository,
        RecoveryService,
        RedisService,
        SystemClock,
        PinoLoggerService,
        CONFIG,
        CredentialsEvents,
      ],
      useFactory: (
        players: PrismaPlayerRepository,
        recovery: RecoveryService,
        redis: RedisService,
        clock: SystemClock,
        logger: PinoLoggerService,
        config: ServerConfig,
        events: CredentialsEvents,
      ) =>
        new EmailAuthService({
          identities: players,
          // Deux hachages a la fois, trente-deux en attente : au-dela, 503.
          // Deux fils de 19 Mio laissent la boucle d'evenements et la memoire
          // du conteneur au jeu, qui en a besoin en plein duel (ADR 0013).
          hasher: new BoundedPasswordHasher(new Argon2PasswordHasher(), {
            maxConcurrent: 2,
            maxQueued: 32,
          }),
          limiter: new RedisAttemptLimiter(redis.client, LIMITS.windowMs),
          recovery,
          events,
          clock,
          // La cle du serveur, deja secrete et deja requise : le HMAC prefixe
          // son message (`email-attempts:`), donc aucune signature de jeton ne
          // peut se confondre avec une empreinte d'adresse.
          traceKey: config.jwtSecret,
          log: { warn: (message) => logger.warn(message, 'EmailAuthService') },
        }),
    },
    // Jeton nomme : le controleur depend du **port**, pas de l'implementation
    // JWT. Remplacer la verification ne demanderait de toucher qu'ici.
    {
      provide: 'ACCESS_TOKEN_VERIFIER',
      inject: [FreshAccessTokenVerifier],
      useFactory: (verifier: FreshAccessTokenVerifier) => verifier,
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
  // `CredentialsEvents` sort aussi : le module match s'y abonne pour fermer
  // les sockets d'un joueur qui vient de changer de mot de passe.
  exports: [
    SessionService,
    SocketAuthenticator,
    PrismaService,
    'ACCESS_TOKEN_VERIFIER',
    CredentialsEvents,
  ],
})
export class AuthModule {}
