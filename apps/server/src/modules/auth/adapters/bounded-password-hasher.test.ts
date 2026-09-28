import { describe, expect, it } from 'vitest';
import { PasswordHasherBusyError, type PasswordHasher } from '../domain/ports.js';
import { BoundedPasswordHasher } from './bounded-password-hasher.js';

/** Un hachage qu'on termine a la main : on voit ce qui tourne en meme temps. */
function manualHasher() {
  const pending: (() => void)[] = [];
  let active = 0;
  let peak = 0;
  const hasher: PasswordHasher = {
    hash: (password) =>
      new Promise((resolve) => {
        active += 1;
        peak = Math.max(peak, active);
        pending.push(() => {
          active -= 1;
          resolve(`h(${password})`);
        });
      }),
    verify: () => Promise.resolve(true),
  };
  return {
    hasher,
    finishOne: async () => {
      pending.shift()?.();
      await new Promise((resolve) => setTimeout(resolve, 0));
    },
    stats: () => ({ active, peak, pending: pending.length }),
  };
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('BoundedPasswordHasher', () => {
  it('ne fait jamais tourner plus de hachages que permis', async () => {
    const inner = manualHasher();
    const bounded = new BoundedPasswordHasher(inner.hasher, { maxConcurrent: 2, maxQueued: 10 });
    const results = Array.from({ length: 6 }, (_, i) => bounded.hash(`p${String(i)}`));
    await flush();
    expect(inner.stats().active).toBe(2);

    for (let i = 0; i < 6; i++) await inner.finishOne();
    await expect(Promise.all(results)).resolves.toHaveLength(6);
    expect(inner.stats().peak).toBe(2);
  });

  it('refuse tout de suite au-dela de la file, sans rien empiler', async () => {
    const inner = manualHasher();
    const bounded = new BoundedPasswordHasher(inner.hasher, { maxConcurrent: 1, maxQueued: 2 });
    const accepted = [bounded.hash('a'), bounded.hash('b'), bounded.hash('c')];
    await expect(bounded.hash('d')).rejects.toBeInstanceOf(PasswordHasherBusyError);

    for (let i = 0; i < 3; i++) await inner.finishOne();
    await expect(Promise.all(accepted)).resolves.toEqual(['h(a)', 'h(b)', 'h(c)']);
  });

  it('libere sa place meme quand le hachage echoue', async () => {
    const failing: PasswordHasher = {
      hash: () => Promise.reject(new Error('panne')),
      verify: () => Promise.resolve(false),
    };
    const bounded = new BoundedPasswordHasher(failing, { maxConcurrent: 1, maxQueued: 0 });
    await expect(bounded.hash('a')).rejects.toThrow('panne');
    // Si la place n'etait pas rendue, ceci serait refuse comme « occupe ».
    await expect(bounded.verify('h', 'a')).resolves.toBe(false);
  });
});
