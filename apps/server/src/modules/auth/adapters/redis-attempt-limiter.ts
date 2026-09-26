import type { RedisClient } from '../../../shared/redis.js';
import type { AttemptKey, AttemptLimiter } from '../domain/ports.js';

/**
 * Limite de tentatives dans Redis (ADR 0013).
 *
 * Redis et non la memoire du processus : un compteur par instance se
 * contournerait en repartissant les essais entre les serveurs, et chaque
 * redemarrage — donc chaque deploiement — remettrait les compteurs a zero.
 * Redis porte deja la file d'attente ; il n'y a rien de neuf a exploiter.
 *
 * Une cle par compteur, `auth:attempts:<portee>`, avec une duree de vie egale
 * a la fenetre : Redis oublie tout seul, rien a nettoyer.
 */

const PREFIX = 'auth:attempts:';

/**
 * Incremente chaque compteur et pose sa duree de vie a la creation.
 *
 * En un seul script : l'increment et la duree de vie ne doivent pas pouvoir
 * se separer. Une panne entre les deux laisserait un compteur **sans fin**, et
 * l'adresse qu'il porte bloquee pour toujours. La fenetre est fixe — posee au
 * premier essai, jamais prolongee — pour qu'un bot qui insiste ne repousse pas
 * indefiniment la fin du blocage de sa victime.
 */
const ATTEMPT_SCRIPT = `
local blocked = 0
for i, key in ipairs(KEYS) do
  local count = redis.call('INCR', key)
  if count == 1 then redis.call('PEXPIRE', key, ARGV[1]) end
  if count > tonumber(ARGV[i + 1]) then blocked = 1 end
end
return blocked
`;

/**
 * Rend une tentative, sans jamais creer de compteur.
 *
 * Un simple `DECR` sur une cle expiree en creerait une a -1, **sans duree de
 * vie** : un credit permanent offert a qui partage cette adresse IP.
 */
const REFUND_SCRIPT = `
local count = tonumber(redis.call('GET', KEYS[1]) or '0')
if count > 0 then return redis.call('DECR', KEYS[1]) end
return 0
`;

export class RedisAttemptLimiter implements AttemptLimiter {
  constructor(
    private readonly client: RedisClient,
    private readonly windowMs: number,
  ) {}

  async attempt(keys: readonly AttemptKey[]): Promise<boolean> {
    if (keys.length === 0) return true;
    const blocked = await this.client.eval(ATTEMPT_SCRIPT, {
      keys: keys.map(({ key }) => PREFIX + key),
      arguments: [String(this.windowMs), ...keys.map(({ limit }) => String(limit))],
    });
    return blocked === 0;
  }

  async peek(key: string): Promise<number> {
    return Number((await this.client.get(PREFIX + key)) ?? 0);
  }

  async reset(key: string): Promise<void> {
    await this.client.del(PREFIX + key);
  }

  async refund(key: string): Promise<void> {
    await this.client.eval(REFUND_SCRIPT, { keys: [PREFIX + key] });
  }
}
