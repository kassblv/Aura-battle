import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { EmailAuthService } from '../application/email.js';
import { IpRateLimit } from '../application/ip-rate-limit.js';
import { ProfileService } from '../application/profile.js';
import { RecoveryService } from '../application/recovery.js';
import { SessionError, SessionService } from '../application/session.js';
import { AuthController } from './auth.controller.js';

/**
 * Bannissement par HTTP (ADR 0018) : `403 BANNED` a l'appareil, au
 * rafraichissement et a la connexion par preuve — jamais un `401` qui ferait
 * boucler le client sur un rafraichissement voue a l'echec.
 */
let app: NestFastifyApplication;
const BANNED = () => Promise.reject(new SessionError('BANNED'));

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({
    controllers: [AuthController],
    providers: [
      {
        provide: SessionService,
        useValue: { authenticateDevice: BANNED, refresh: BANNED, joinWithDevice: BANNED },
      },
      {
        provide: EmailAuthService,
        useValue: { login: () => Promise.resolve({ playerId: 'p1', credentialsVersion: 0 }) },
      },
      { provide: ProfileService, useValue: {} },
      { provide: RecoveryService, useValue: {} },
      { provide: IpRateLimit, useValue: { allow: () => Promise.resolve('ALLOWED') } },
      { provide: 'ACCESS_TOKEN_VERIFIER', useValue: { verify: () => Promise.reject(new Error()) } },
    ],
  }).compile();
  app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
});

afterAll(async () => {
  await app.close();
});

const post = (url: string, payload: Record<string, unknown>) =>
  app.inject({ method: 'POST', url, payload });

describe('routes de session d un banni', () => {
  it('POST /auth/device : 403 BANNED', async () => {
    const reply = await post('/auth/device', { deviceSecret: 'a'.repeat(64) });
    expect(reply.statusCode).toBe(403);
    expect(reply.json()).toEqual({ code: 'BANNED', message: 'compte suspendu' });
  });

  it('POST /auth/refresh : 403 BANNED', async () => {
    const reply = await post('/auth/refresh', { refreshToken: 'r'.repeat(64) });
    expect(reply.statusCode).toBe(403);
    expect(reply.json<{ code: string }>().code).toBe('BANNED');
  });

  it('POST /auth/email/login : 403 BANNED', async () => {
    const reply = await post('/auth/email/login', {
      email: 'banni@exemple.test',
      password: 'aura du dimanche',
      deviceSecret: 'b'.repeat(64),
    });
    expect(reply.statusCode).toBe(403);
    expect(reply.json<{ code: string }>().code).toBe('BANNED');
  });
});
