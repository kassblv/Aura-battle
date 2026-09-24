import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { EmailAuthService, LIMITS } from '../application/email.js';
import { IP_RATE_LIMITS, IpRateLimit } from '../application/ip-rate-limit.js';
import { fakePasswordHasher, memoryEmailIdentities } from '../application/email-testing.js';
import { ProfileService } from '../application/profile.js';
import { RecoveryError, RecoveryService } from '../application/recovery.js';
import { SessionService } from '../application/session.js';
import { PasswordHasherBusyError } from '../domain/ports.js';
import type { PasswordHasher, PlayerRecord } from '../domain/ports.js';
import { hashSecret } from '../domain/credentials.js';
import { MemoryAttemptLimiter } from './memory-attempt-limiter.js';
import { AuthController } from './auth.controller.js';

/**
 * Les routes email, par HTTP, dans un vrai Fastify.
 *
 * Le service a ses propres tests ; ici on verifie ce que seul le transport
 * peut montrer : les codes HTTP, le corps que lit le client, l'absence de tout
 * secret dans les reponses, et l'adresse IP que la limite de tentatives voit
 * reellement derriere un mandataire.
 */

const players: PlayerRecord[] = Array.from({ length: 40 }, (_, i) => ({
  id: `p${String(i)}`,
  displayName: `Joueur ${String(i)}`,
}));
const GOOD = 'aura du dimanche';
const BUSY = 'serveur tres occupe';

let app: NestFastifyApplication;
const identities = memoryEmailIdentities(players);
/** Le secret d'appareil du joueur `pN` : chaque joueur a deja le sien. */
const deviceOf = (n: number): string => String(n).padStart(64, '0');
for (let n = 0; n < players.length; n++) {
  identities.devices.set(hashSecret(deviceOf(n)), `p${String(n)}`);
}
const opened: string[] = [];
const linkedDevices: { playerId: string; deviceSecret: string }[] = [];

beforeAll(async () => {
  const fake = fakePasswordHasher();
  // Un mot de passe convenu fait repondre le plafond global « occupe ».
  const hasher: PasswordHasher = {
    hash: (password) =>
      password === BUSY
        ? Promise.reject(new PasswordHasherBusyError())
        : fake.hasher.hash(password),
    verify: (hash, password) => fake.hasher.verify(hash, password),
  };
  const email = new EmailAuthService({
    identities: identities.port,
    hasher,
    limiter: new MemoryAttemptLimiter({ windowMs: LIMITS.windowMs, now: () => 0 }),
    recovery: {
      // Delivre a l'epoque : assez ancien pour servir de preuve.
      prove: (code) =>
        code === 'AURA-P3'
          ? Promise.resolve({ player: players[3]!, issuedAt: new Date(0) })
          : Promise.reject(new RecoveryError('INVALID_RECOVERY_CODE')),
    },
    clock: { now: () => new Date(24 * 60 * 60_000) },
    events: { publish: () => undefined },
    traceKey: 'une-cle-de-test-assez-longue',
    log: { warn: () => undefined },
  });

  const moduleRef = await Test.createTestingModule({
    controllers: [AuthController],
    providers: [
      { provide: EmailAuthService, useValue: email },
      {
        provide: SessionService,
        // Le chemin d'emission habituel, reduit a ce que ces routes appellent.
        useValue: {
          linkDevice: (playerId: string, deviceSecret: string) => {
            linkedDevices.push({ playerId, deviceSecret });
            return Promise.resolve();
          },
          refresh: () => Promise.reject(new Error('non utilise')),
          openForPlayer: (playerId: string) => {
            opened.push(playerId);
            return Promise.resolve({
              accessToken: `jwt.${playerId}`,
              refreshToken: `refresh.${playerId}`,
              expiresIn: 900,
              player: { id: playerId, displayName: 'x', guest: true },
            });
          },
        },
      },
      { provide: ProfileService, useValue: {} },
      {
        provide: RecoveryService,
        useValue: {
          issue: () => Promise.resolve('AURA-0000-0000-0000-0000'),
          claim: (code: string) =>
            code === 'AURA-P7'
              ? Promise.resolve(players[7]!)
              : Promise.reject(new RecoveryError('INVALID_RECOVERY_CODE')),
        },
      },
      {
        provide: IpRateLimit,
        // Une vraie limite, sur un compteur en memoire : le 21e code presente
        // depuis la meme adresse est refuse.
        useValue: new IpRateLimit(
          new MemoryAttemptLimiter({ windowMs: LIMITS.windowMs, now: () => 0 }),
          true,
        ),
      },
      {
        provide: 'ACCESS_TOKEN_VERIFIER',
        useValue: {
          verify: (token: string) =>
            token.startsWith('jwt.')
              ? Promise.resolve({ sub: token.slice(4) })
              : Promise.reject(new Error('jeton invalide')),
        },
      },
    ],
  }).compile();

  // Un mandataire de confiance, comme en production derriere Traefik : ici
  // l'injection de Fastify, qui parle depuis 127.0.0.1.
  app = moduleRef.createNestApplication<NestFastifyApplication>(
    new FastifyAdapter({ trustProxy: 'loopback' }),
  );
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
});

afterAll(async () => {
  await app.close();
});

function call(
  method: 'GET' | 'POST',
  url: string,
  options: { token?: string; body?: object; forwardedFor?: string } = {},
) {
  const headers: Record<string, string> = {};
  if (options.token !== undefined) headers.authorization = `Bearer ${options.token}`;
  if (options.forwardedFor !== undefined) headers['x-forwarded-for'] = options.forwardedFor;
  return app.inject({
    method,
    url,
    headers,
    ...(options.body === undefined ? {} : { payload: options.body }),
  });
}

describe('POST /auth/email/link', () => {
  it('exige une session', async () => {
    const reply = await call('POST', '/auth/email/link', {
      body: { email: 'a@exemple.fr', password: GOOD },
    });
    expect(reply.statusCode).toBe(401);
  });

  it('rattache, puis rend l adresse masquee et jamais le hache', async () => {
    const reply = await call('POST', '/auth/email/link', {
      token: 'jwt.p0',
      body: { deviceSecret: deviceOf(0), email: 'Zoe@Exemple.fr', password: GOOD },
    });
    expect(reply.statusCode).toBe(201);
    expect(reply.json<Record<string, unknown>>()).toEqual({
      linked: true,
      maskedEmail: 'z•••@exemple.fr',
    });

    const status = await call('GET', '/auth/email', { token: 'jwt.p0' });
    expect(status.json<Record<string, unknown>>()).toEqual({
      linked: true,
      maskedEmail: 'z•••@exemple.fr',
    });
    expect(status.body).not.toContain('zoe@');
    expect(status.body).not.toContain('h(');
  });

  it('refuse une adresse prise par un autre, en 409 generique', async () => {
    await call('POST', '/auth/email/link', {
      token: 'jwt.p1',
      body: { deviceSecret: deviceOf(1), email: 'prise@exemple.fr', password: GOOD },
    });
    const reply = await call('POST', '/auth/email/link', {
      token: 'jwt.p2',
      body: { deviceSecret: deviceOf(2), email: 'prise@exemple.fr', password: GOOD },
    });
    expect(reply.statusCode).toBe(409);
    expect(reply.json<Record<string, unknown>>().code).toBe('EMAIL_UNAVAILABLE');
    expect(reply.body).not.toContain('p1');
  });

  it('dit pourquoi un mot de passe est refuse', async () => {
    const common = await call('POST', '/auth/email/link', {
      token: 'jwt.p5',
      body: { deviceSecret: deviceOf(5), email: 'cinq@exemple.fr', password: 'motdepasse' },
    });
    expect(common.statusCode).toBe(400);
    expect(common.json<Record<string, unknown>>().code).toBe('PASSWORD_TOO_COMMON');

    const short = await call('POST', '/auth/email/link', {
      token: 'jwt.p5',
      body: { deviceSecret: deviceOf(5), email: 'cinq@exemple.fr', password: 'court' },
    });
    expect(short.statusCode).toBe(400);
    expect(short.json<Record<string, unknown>>().code).toBe('INVALID_PAYLOAD');
  });
});

describe('POST /auth/email/login', () => {
  beforeAll(async () => {
    await call('POST', '/auth/email/link', {
      token: 'jwt.p3',
      body: { deviceSecret: deviceOf(3), email: 'trois@exemple.fr', password: GOOD },
    });
  });

  it('ouvre la session du compte par le chemin habituel', async () => {
    const reply = await call('POST', '/auth/email/login', {
      body: { deviceSecret: 'e'.repeat(64), email: 'TROIS@exemple.fr', password: GOOD },
      forwardedFor: '10.0.0.1',
    });
    expect(reply.statusCode).toBe(200);
    expect(reply.json<Record<string, unknown>>().accessToken).toBe('jwt.p3');
    expect(opened).toContain('p3');
  });

  it('rend exactement la meme reponse pour une adresse inconnue et un mauvais mot de passe', async () => {
    const unknown = await call('POST', '/auth/email/login', {
      body: { deviceSecret: 'e'.repeat(64), email: 'personne@exemple.fr', password: GOOD },
      forwardedFor: '10.0.0.2',
    });
    const wrong = await call('POST', '/auth/email/login', {
      body: { deviceSecret: 'e'.repeat(64), email: 'trois@exemple.fr', password: 'pas le bon' },
      forwardedFor: '10.0.0.2',
    });
    expect(unknown.statusCode).toBe(401);
    expect(wrong.statusCode).toBe(401);
    expect(wrong.body).toBe(unknown.body);
    expect(unknown.json<Record<string, unknown>>().code).toBe('INVALID_CREDENTIALS');
  });

  it('ferme une adresse apres cinq echecs, en 429', async () => {
    await call('POST', '/auth/email/link', {
      token: 'jwt.p6',
      body: { deviceSecret: deviceOf(6), email: 'six@exemple.fr', password: GOOD },
    });
    for (let i = 0; i < LIMITS.loginPerEmail; i++) {
      await call('POST', '/auth/email/login', {
        body: { deviceSecret: 'e'.repeat(64), email: 'six@exemple.fr', password: 'faux' },
        forwardedFor: `10.1.0.${String(i)}`,
      });
    }
    const reply = await call('POST', '/auth/email/login', {
      body: { deviceSecret: 'e'.repeat(64), email: 'six@exemple.fr', password: GOOD },
      forwardedFor: '10.1.0.99',
    });
    expect(reply.statusCode).toBe(429);
    expect(reply.json<Record<string, unknown>>().code).toBe('TOO_MANY_ATTEMPTS');
  });

  /*
    Derriere Traefik, seule l'entree de DROITE de `X-Forwarded-For` est
    ecrite par le mandataire ; tout ce qui est a gauche vient du client. Un
    bot qui invente une adresse a gauche a chaque requete ne doit pas
    s'offrir un compteur neuf a chaque fois.
  */
  it('compte par adresse reelle, pas par ce que le client ecrit dans l en-tete', async () => {
    for (let i = 0; i < LIMITS.loginPerIp; i++) {
      await call('POST', '/auth/email/login', {
        body: {
          deviceSecret: 'e'.repeat(64),
          email: `cible${String(i)}@exemple.fr`,
          password: 'faux',
        },
        forwardedFor: `203.0.113.${String(i)}, 10.2.0.1`,
      });
    }
    const blocked = await call('POST', '/auth/email/login', {
      body: { deviceSecret: 'e'.repeat(64), email: 'trois@exemple.fr', password: GOOD },
      forwardedFor: '198.51.100.7, 10.2.0.1',
    });
    expect(blocked.statusCode).toBe(429);

    // Un autre joueur, derriere le meme Traefik, n'est pas puni pour le bot.
    const other = await call('POST', '/auth/email/login', {
      body: { deviceSecret: 'e'.repeat(64), email: 'trois@exemple.fr', password: GOOD },
      forwardedFor: '10.2.0.2',
    });
    expect(other.statusCode).toBe(200);
  });
});

describe('POST /auth/email/password', () => {
  beforeAll(async () => {
    await call('POST', '/auth/email/link', {
      token: 'jwt.p4',
      body: { deviceSecret: deviceOf(4), email: 'quatre@exemple.fr', password: GOOD },
    });
  });

  it('change sur preuve de l ancien', async () => {
    const reply = await call('POST', '/auth/email/password', {
      token: 'jwt.p4',
      body: { currentPassword: GOOD, newPassword: 'nouvelle phrase' },
    });
    // Une session fraiche : l'ancienne vient d'etre invalidee avec le reste.
    expect(reply.statusCode).toBe(200);
    expect(reply.json<Record<string, unknown>>().accessToken).toBe('jwt.p4');
  });

  it('refuse une preuve fausse', async () => {
    const reply = await call('POST', '/auth/email/password', {
      token: 'jwt.p4',
      body: { currentPassword: 'faux', newPassword: 'encore une autre' },
    });
    expect(reply.statusCode).toBe(401);
    expect(reply.json<Record<string, unknown>>().code).toBe('INVALID_CREDENTIALS');
  });

  it('accepte le code de recuperation du joueur : le mot de passe oublie', async () => {
    const reply = await call('POST', '/auth/email/password', {
      token: 'jwt.p3',
      body: { recoveryCode: 'AURA-P3', newPassword: 'phrase retrouvee' },
    });
    expect(reply.statusCode).toBe(200);
  });

  it('refuse un joueur sans adresse', async () => {
    const reply = await call('POST', '/auth/email/password', {
      token: 'jwt.p9',
      body: { currentPassword: GOOD, newPassword: 'nouvelle phrase' },
    });
    expect(reply.statusCode).toBe(409);
    expect(reply.json<Record<string, unknown>>().code).toBe('EMAIL_NOT_LINKED');
  });
});

describe('GET /auth/email', () => {
  it('dit « aucune adresse » a qui n en a pas', async () => {
    const reply = await call('GET', '/auth/email', { token: 'jwt.p8' });
    expect(reply.json<Record<string, unknown>>()).toEqual({ linked: false, maskedEmail: null });
  });

  it('exige une session', async () => {
    expect((await call('GET', '/auth/email')).statusCode).toBe(401);
  });
});

describe('POST /auth/recovery', () => {
  /*
    Relecture de securite : une session seule ne doit plus pouvoir remplacer
    le code d'un compte qui a une adresse — l'intrus s'en servirait ensuite
    pour changer le mot de passe.
  */
  it('exige le mot de passe quand une adresse est rattachee', async () => {
    await call('POST', '/auth/email/link', {
      token: 'jwt.p10',
      body: { deviceSecret: deviceOf(10), email: 'dix@exemple.fr', password: GOOD },
    });
    const refused = await call('POST', '/auth/recovery', { token: 'jwt.p10' });
    expect(refused.statusCode).toBe(403);
    expect(refused.json<Record<string, unknown>>().code).toBe('PASSWORD_REQUIRED');

    const wrong = await call('POST', '/auth/recovery', {
      token: 'jwt.p10',
      body: { currentPassword: 'faux' },
    });
    expect(wrong.statusCode).toBe(401);

    const ok = await call('POST', '/auth/recovery', {
      token: 'jwt.p10',
      body: { currentPassword: GOOD },
    });
    expect(ok.statusCode).toBe(201);
    expect(ok.json<Record<string, unknown>>().code).toMatch(/^AURA-/);
  });

  /* Seconde relecture (B) : sans adresse, un jeton vole ne suffit plus. */
  it('exige la preuve d un appareil du joueur sur un compte sans adresse', async () => {
    const refused = await call('POST', '/auth/recovery', { token: 'jwt.p11' });
    expect(refused.statusCode).toBe(403);
    expect(refused.json<Record<string, unknown>>().code).toBe('DEVICE_PROOF_REQUIRED');

    const ok = await call('POST', '/auth/recovery', {
      token: 'jwt.p11',
      body: { deviceSecret: deviceOf(11) },
    });
    expect(ok.statusCode).toBe(201);
  });
});

describe('plafond global du hachage', () => {
  it('repond 503 BUSY plutot que d empiler', async () => {
    const reply = await call('POST', '/auth/email/link', {
      token: 'jwt.p12',
      body: { deviceSecret: deviceOf(12), email: 'douze@exemple.fr', password: BUSY },
    });
    expect(reply.statusCode).toBe(503);
    expect(reply.json<Record<string, unknown>>().code).toBe('BUSY');
  });
});

/*
  Troisieme relecture (1) : il n'existe plus de route qui rattache un appareil
  sur la seule foi d'un jeton. Le rattachement suit toujours une preuve.
*/
describe('rattachement d appareil', () => {
  it('n expose plus de route autonome de rattachement', async () => {
    const reply = await call('POST', '/auth/device/link', {
      token: 'jwt.p7',
      body: { deviceSecret: 'f'.repeat(64) },
    });
    expect(reply.statusCode).toBe(404);
  });

  it('rattache l appareil dans le meme geste que le code presente', async () => {
    const reply = await call('POST', '/auth/recovery/claim', {
      body: { code: 'AURA-P7', deviceSecret: 'f'.repeat(64) },
      forwardedFor: '10.7.0.1',
    });
    expect(reply.statusCode).toBe(201);
    expect(linkedDevices).toContainEqual({ playerId: 'p7', deviceSecret: 'f'.repeat(64) });
  });

  it('ne rattache rien sur un code refuse', async () => {
    const before = linkedDevices.length;
    const reply = await call('POST', '/auth/recovery/claim', {
      body: { code: 'AURA-FAUX', deviceSecret: 'd'.repeat(64) },
      forwardedFor: '10.7.0.2',
    });
    expect(reply.statusCode).toBe(401);
    expect(linkedDevices).toHaveLength(before);
  });

  it('rattache l appareil dans le meme geste que l email presente', async () => {
    await call('POST', '/auth/email/link', {
      token: 'jwt.p13',
      body: { deviceSecret: deviceOf(13), email: 'treize@exemple.fr', password: GOOD },
    });
    const reply = await call('POST', '/auth/email/login', {
      body: { email: 'treize@exemple.fr', password: GOOD, deviceSecret: 'c'.repeat(64) },
      forwardedFor: '10.7.0.3',
    });
    expect(reply.statusCode).toBe(200);
    expect(linkedDevices).toContainEqual({ playerId: 'p13', deviceSecret: 'c'.repeat(64) });
  });
});

/* Troisieme relecture (3) : les routes publiques sont bornees par IP. */
describe('limite de debit des routes publiques', () => {
  it('refuse le code presente de trop depuis la meme adresse', async () => {
    for (let i = 0; i < IP_RATE_LIMITS.claim; i++) {
      await call('POST', '/auth/recovery/claim', {
        body: { code: 'AURA-FAUX', deviceSecret: 'd'.repeat(64) },
        forwardedFor: '10.9.0.1',
      });
    }
    const reply = await call('POST', '/auth/recovery/claim', {
      body: { code: 'AURA-P7', deviceSecret: 'd'.repeat(64) },
      forwardedFor: '10.9.0.1',
    });
    expect(reply.statusCode).toBe(429);
    expect(reply.json<Record<string, unknown>>().code).toBe('TOO_MANY_ATTEMPTS');
  });
});
