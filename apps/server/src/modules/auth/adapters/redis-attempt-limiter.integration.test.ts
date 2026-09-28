import { createClient } from 'redis';
import { describe, expect, it } from 'vitest';
import type { RedisClient } from '../../../shared/redis.js';
import { describeAttemptLimiterContract } from './attempt-limiter.contract.js';
import { RedisAttemptLimiter } from './redis-attempt-limiter.js';

/**
 * Test d'integration : c'est **Redis** qui doit tenir le contrat de la limite
 * de tentatives — l'expiration reelle de la fenetre, et les scripts Lua.
 *
 * Meme convention que `matchmaking/adapters/redis-queue.store.integration.test.ts` :
 * chargement du `.env`, garde-fou d'hote local, saut propre si l'instance est
 * injoignable.
 */

try {
  process.loadEnvFile(new URL('../../../../../../.env', import.meta.url));
} catch {
  // En CI les variables viennent de l'environnement.
}

const redisUrl = process.env.REDIS_URL ?? '';

/**
 * Ce test **ecrit et supprime** des cles : il ne doit jamais viser autre chose
 * qu'une instance locale. Un `.env` de preprod oublie remettrait a zero les
 * compteurs de vrais joueurs.
 */
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1', 'host.docker.internal']);

function isLocalRedis(url: string): boolean {
  try {
    return LOCAL_HOSTS.has(new URL(url).hostname);
  } catch {
    return false;
  }
}

/**
 * La joignabilite se decide **au chargement du module** : `describe.skipIf` est
 * evalue a la collecte, donc avant tout `beforeAll`.
 */
async function connect(): Promise<RedisClient | null> {
  if (redisUrl === '' || !isLocalRedis(redisUrl)) return null;
  try {
    const client: RedisClient = createClient({
      url: redisUrl,
      // Sans plafond, une instance absente ferait boucler la reconnexion
      // pendant toute la suite au lieu de la sauter proprement.
      socket: { reconnectStrategy: false, connectTimeout: 1_000 },
    });
    client.on('error', () => {
      // La joignabilite est decidee par `connect`, pas par cet evenement ;
      // sans ecouteur, node-redis ferait tomber le processus de test.
    });
    await client.connect();
    await client.ping();
    return client;
  } catch {
    return null;
  }
}

const probe = await connect();
const reachable = probe !== null;
await probe?.close();

describe.skipIf(!reachable)('limite de tentatives reelle', () => {
  describeAttemptLimiterContract('Redis', async (windowMs) => {
    const client = (await connect())!;
    return {
      limiter: new RedisAttemptLimiter(client, windowMs),
      elapse: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
      close: () => client.close(),
    };
  });

  /*
    Le compteur doit mourir seul. Un compteur sans duree de vie bloquerait
    son adresse pour toujours — et c'est exactement ce qu'un DECR naif sur
    une cle expiree fabrique.
  */
  it('pose une duree de vie sur chaque compteur, et n en cree pas en rendant', async () => {
    const client = (await connect())!;
    const limiter = new RedisAttemptLimiter(client, 60_000);
    const key = `test:ttl:${String(Date.now())}`;

    await limiter.attempt([{ key, limit: 5 }]);
    const ttl = await client.pTTL(`auth:attempts:${key}`);
    expect(ttl).toBeGreaterThan(0);
    expect(ttl).toBeLessThanOrEqual(60_000);

    await limiter.reset(key);
    await limiter.refund(key);
    expect(await client.exists(`auth:attempts:${key}`)).toBe(0);
    await client.close();
  });
});

describe.skipIf(reachable)('Redis indisponible', () => {
  it('signale pourquoi le test d integration a ete saute', () => {
    console.warn(
      '[integration] Redis injoignable ou non local sur REDIS_URL — lancez `docker compose up -d` pour executer les tests de limite de tentatives',
    );
    expect(reachable).toBe(false);
  });
});
