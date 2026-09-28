import { createClient } from 'redis';
import { describe, expect, it } from 'vitest';
import type { RedisClient } from '../../../shared/redis.js';
import { RedisQueueStore } from './redis-queue.store.js';
import { describeQueueStoreContract } from './queue-store.contract.js';

/**
 * Test d'integration : c'est **Redis** qui doit tenir le contrat de la file.
 *
 * Le double en memoire ne prouve que le double. Ce qui compte ici ne peut pas
 * etre simule : l'atomicite du script Lua de reclamation, l'ordre d'anciennete
 * rendu par l'ensemble trie, et le fait qu'un ticket illisible n'emporte pas
 * tout le tour d'appariement.
 *
 * Meme convention que les tests d'integration Postgres voisins : chargement du
 * `.env`, garde-fou d'hote local, saut propre si l'instance est injoignable.
 */

try {
  process.loadEnvFile(new URL('../../../../../../.env', import.meta.url));
} catch {
  // En CI les variables viennent de l'environnement.
}

const redisUrl = process.env.REDIS_URL ?? '';

/**
 * Ce test **ecrit et supprime** des cles : il ne doit jamais viser autre chose
 * qu'une instance locale. Un `.env` de preprod oublie viderait des tickets de
 * vrais joueurs.
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

describe.skipIf(!reachable)('file d attente reelle', () => {
  describeQueueStoreContract('Redis', async () => {
    const client = (await connect())!;
    return {
      store: new RedisQueueStore(client),
      close: () => client.close(),
    };
  });

  describe('robustesse de la lecture', () => {
    /**
     * Un octet ecrit par une autre version du serveur ne doit pas empecher les
     * autres joueurs d'etre apparies. Le ticket illisible disparait, la file
     * continue.
     */
    it('ecarte un ticket illisible et nettoie sa place dans la file', async () => {
      const client = (await connect())!;
      const store = new RedisQueueStore(client);
      const playerId = `mmtest_corrompu_${String(Date.now())}`;

      await client.zAdd('mm:queue', { score: 1_000, value: playerId });
      await client.set(`mm:ticket:${playerId}`, '{ pas du json', { EX: 60 });

      const waiting = await store.listWaiting();
      expect(waiting.map((t) => t.playerId)).not.toContain(playerId);
      expect(await client.zScore('mm:queue', playerId)).toBeNull();

      await client.close();
    });

    /**
     * Deux serveurs sur le meme Redis ne se detruisent pas leurs files.
     *
     * Chacun ne peut notifier que ses propres joueurs : voir le ticket d'un
     * autre serveur et le juger « deconnecte » reviendrait a vider la file de
     * son voisin a chaque tour. Le ticket etranger doit donc etre ignore — ni
     * lu, ni retire.
     */
    it('ignore le ticket d une autre instance sans le detruire', async () => {
      const client = (await connect())!;
      const voisin = new RedisQueueStore(client, 'noeud-voisin');
      const notre = new RedisQueueStore(client, 'notre-noeud');
      const playerId = `mmtest_voisin_${String(Date.now())}`;

      await voisin.add({
        playerId,
        mode: 'ranked',
        mmr: 1000,
        enqueuedAtMs: 1_000,
        region: 'global',
        recentOpponents: [],
      });

      expect((await notre.listWaiting()).map((t) => t.playerId)).not.toContain(playerId);
      expect(await notre.get(playerId)).toBeNull();
      // Intact pour son proprietaire.
      expect(await voisin.get(playerId)).not.toBeNull();
      expect((await voisin.listWaiting()).map((t) => t.playerId)).toContain(playerId);

      await voisin.remove(playerId);
      await client.close();
    });

    /** Une entree de file dont le ticket a expire est ramassee a la lecture. */
    it('ecarte une entree dont le ticket a expire', async () => {
      const client = (await connect())!;
      const store = new RedisQueueStore(client);
      const playerId = `mmtest_expire_${String(Date.now())}`;

      await client.zAdd('mm:queue', { score: 1_000, value: playerId });

      expect((await store.listWaiting()).map((t) => t.playerId)).not.toContain(playerId);
      expect(await client.zScore('mm:queue', playerId)).toBeNull();

      await client.close();
    });
  });
});

describe.skipIf(reachable)('Redis indisponible', () => {
  it('saute la suite plutot que de la faire echouer', () => {
    expect(reachable).toBe(false);
  });
});
