import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import type { AttemptLimiter } from '../domain/ports.js';

/**
 * Contrat de la limite de tentatives, joue sur **chaque** adaptateur.
 *
 * Meme principe que la file d'attente (`queue-store.contract.ts`) : le double
 * en memoire sert aux tests du service, et s'il s'ecartait de Redis, tous ces
 * tests mentiraient a l'unisson.
 */

export interface LimiterUnderTest {
  readonly limiter: AttemptLimiter;
  /** Fait passer le temps : horloge factice en memoire, vraie attente pour Redis. */
  readonly elapse: (ms: number) => Promise<void>;
  readonly close: () => Promise<void>;
}

/** Cles neuves a chaque appel : l'instance Redis de developpement est partagee. */
const newKey = (): string => `test:${randomUUID()}`;

export function describeAttemptLimiterContract(
  label: string,
  /** La fenetre est courte pour que Redis la voie expirer en vrai. */
  open: (windowMs: number) => Promise<LimiterUnderTest>,
): void {
  describe(`limite de tentatives (${label})`, () => {
    it('laisse passer jusqu a la limite, puis refuse', async () => {
      const { limiter, close } = await open(60_000);
      const key = newKey();
      for (let i = 0; i < 3; i++) {
        await expect(limiter.attempt([{ key, limit: 3 }])).resolves.toBe(true);
      }
      await expect(limiter.attempt([{ key, limit: 3 }])).resolves.toBe(false);
      await close();
    });

    it('refuse des qu une seule des cles depasse, et compte sur toutes', async () => {
      const { limiter, close } = await open(60_000);
      const tight = newKey();
      const loose = newKey();
      await limiter.attempt([{ key: tight, limit: 1 }]);
      await expect(
        limiter.attempt([
          { key: loose, limit: 10 },
          { key: tight, limit: 1 },
        ]),
      ).resolves.toBe(false);
      // La tentative refusee a quand meme ete comptee sur la cle large.
      for (let i = 0; i < 9; i++) await limiter.attempt([{ key: loose, limit: 10 }]);
      await expect(limiter.attempt([{ key: loose, limit: 10 }])).resolves.toBe(false);
      await close();
    });

    it('oublie tout a la fin de la fenetre', async () => {
      const { limiter, elapse, close } = await open(300);
      const key = newKey();
      await limiter.attempt([{ key, limit: 1 }]);
      await expect(limiter.attempt([{ key, limit: 1 }])).resolves.toBe(false);
      await elapse(450);
      await expect(limiter.attempt([{ key, limit: 1 }])).resolves.toBe(true);
      await close();
    });

    it('lit un compteur sans le toucher', async () => {
      const { limiter, close } = await open(60_000);
      const key = newKey();
      await expect(limiter.peek(key)).resolves.toBe(0);
      await limiter.attempt([{ key, limit: 5 }]);
      await limiter.attempt([{ key, limit: 5 }]);
      await expect(limiter.peek(key)).resolves.toBe(2);
      await expect(limiter.peek(key)).resolves.toBe(2);
      await close();
    });

    it('remet un compteur a zero', async () => {
      const { limiter, close } = await open(60_000);
      const key = newKey();
      await limiter.attempt([{ key, limit: 1 }]);
      await limiter.reset(key);
      await expect(limiter.attempt([{ key, limit: 1 }])).resolves.toBe(true);
      await close();
    });

    it('rend une tentative', async () => {
      const { limiter, close } = await open(60_000);
      const key = newKey();
      await limiter.attempt([{ key, limit: 1 }]);
      await limiter.refund(key);
      await expect(limiter.attempt([{ key, limit: 1 }])).resolves.toBe(true);
      await close();
    });

    /*
      Rendre sur un compteur absent ne doit pas creer de credit : sinon il
      suffirait de reussir une connexion pour s'offrir des essais d'avance.
    */
    it('ne cree pas de credit en rendant sur un compteur absent', async () => {
      const { limiter, close } = await open(60_000);
      const key = newKey();
      await limiter.refund(key);
      await limiter.refund(key);
      await expect(limiter.attempt([{ key, limit: 1 }])).resolves.toBe(true);
      await expect(limiter.attempt([{ key, limit: 1 }])).resolves.toBe(false);
      await close();
    });
  });
}
