import type { AttemptKey, AttemptLimiter } from '../domain/ports.js';

/**
 * Limite de tentatives en memoire de processus.
 *
 * Le double de `RedisAttemptLimiter`, et il passe la **meme suite de contrat**
 * (`attempt-limiter.contract.ts`). Il ne sert qu'aux tests : en production un
 * compteur par processus serait contourne en repartissant les essais entre
 * les instances, et remis a zero a chaque redemarrage.
 *
 * Le temps est une entree : l'expiration de la fenetre se teste sans attendre
 * quinze minutes.
 */
export interface MemoryAttemptLimiterOptions {
  readonly windowMs: number;
  readonly now: () => number;
}

export class MemoryAttemptLimiter implements AttemptLimiter {
  private readonly counters = new Map<string, { count: number; expiresAt: number }>();

  constructor(private readonly options: MemoryAttemptLimiterOptions) {}

  private live(key: string): { count: number; expiresAt: number } | undefined {
    const counter = this.counters.get(key);
    if (counter !== undefined && counter.expiresAt <= this.options.now()) {
      this.counters.delete(key);
      return undefined;
    }
    return counter;
  }

  attempt(keys: readonly AttemptKey[]): Promise<boolean> {
    let allowed = true;
    for (const { key, limit } of keys) {
      // Fenetre fixe ouverte par la premiere tentative, comme `EXPIRE ... NX`
      // cote Redis : insister ne la prolonge pas.
      const counter = this.live(key) ?? {
        count: 0,
        expiresAt: this.options.now() + this.options.windowMs,
      };
      counter.count += 1;
      this.counters.set(key, counter);
      if (counter.count > limit) allowed = false;
    }
    return Promise.resolve(allowed);
  }

  reset(key: string): Promise<void> {
    this.counters.delete(key);
    return Promise.resolve();
  }

  refund(key: string): Promise<void> {
    const counter = this.live(key);
    if (counter !== undefined) counter.count = Math.max(0, counter.count - 1);
    return Promise.resolve();
  }
}
