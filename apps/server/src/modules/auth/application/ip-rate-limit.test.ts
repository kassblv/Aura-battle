import { describe, expect, it } from 'vitest';
import { MemoryAttemptLimiter } from '../adapters/memory-attempt-limiter.js';
import { IP_RATE_LIMITS, IpRateLimit } from './ip-rate-limit.js';

const limiter = () => new MemoryAttemptLimiter({ windowMs: 15 * 60_000, now: () => 0 });

describe('IpRateLimit', () => {
  it('laisse passer jusqu a la limite de la portee, puis refuse', async () => {
    const sut = new IpRateLimit(limiter(), true);
    for (let i = 0; i < IP_RATE_LIMITS.claim; i++) {
      await expect(sut.allow('claim', '203.0.113.1')).resolves.toBe('ALLOWED');
    }
    await expect(sut.allow('claim', '203.0.113.1')).resolves.toBe('LIMITED');
    // Chaque portee a son compteur.
    await expect(sut.allow('refresh', '203.0.113.1')).resolves.toBe('ALLOWED');
  });

  it('compte par seau : toute une IPv6 /64 partage le compteur', async () => {
    const sut = new IpRateLimit(limiter(), true);
    for (let i = 0; i < IP_RATE_LIMITS.device; i++) {
      await sut.allow('device', `2001:db8:1:2::${i.toString(16)}`);
    }
    await expect(sut.allow('device', '2001:db8:1:2::ffff')).resolves.toBe('LIMITED');
  });

  it('refuse une requete sans adresse lisible', async () => {
    const sut = new IpRateLimit(limiter(), true);
    await expect(sut.allow('refresh', undefined)).resolves.toBe('NO_ADDRESS');
  });

  it('laisse tout passer quand la limite est desactivee (bancs de charge)', async () => {
    const sut = new IpRateLimit(limiter(), false);
    for (let i = 0; i < IP_RATE_LIMITS.claim + 5; i++) {
      await expect(sut.allow('claim', undefined)).resolves.toBe('ALLOWED');
    }
  });

  /* Un joueur legitime relance son jeu et renouvelle sa session sans jamais y toucher. */
  it('laisse de la marge a un joueur legitime', () => {
    expect(IP_RATE_LIMITS.refresh).toBeGreaterThanOrEqual(60);
    expect(IP_RATE_LIMITS.device).toBeGreaterThanOrEqual(20);
  });
});
