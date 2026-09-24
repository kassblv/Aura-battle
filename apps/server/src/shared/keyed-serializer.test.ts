import { describe, expect, it } from 'vitest';
import { KeyedSerializer } from './keyed-serializer.js';

/** Une promesse qu'on resout a la main, pour choisir l'ordre des fins. */
function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

/** Laisse s'ecouler toutes les microtaches en attente. */
const settle = () => new Promise((done) => setImmediate(done));

describe('KeyedSerializer', () => {
  it('execute les taches d une meme cle l une apres l autre, dans l ordre d arrivee', async () => {
    const serializer = new KeyedSerializer();
    const gate = deferred();
    const log: string[] = [];

    const first = serializer.run('p-1', async () => {
      log.push('debut 1');
      await gate.promise;
      log.push('fin 1');
    });
    const second = serializer.run('p-1', () => {
      log.push('debut 2');
      return Promise.resolve();
    });

    await settle();
    expect(log).toEqual(['debut 1']);
    gate.resolve();
    await Promise.all([first, second]);
    expect(log).toEqual(['debut 1', 'fin 1', 'debut 2']);
  });

  it('laisse les cles differentes avancer en parallele', async () => {
    const serializer = new KeyedSerializer();
    const gate = deferred();
    const log: string[] = [];

    const blocked = serializer.run('p-1', () => gate.promise);
    await serializer.run('p-2', () => {
      log.push('p-2');
      return Promise.resolve();
    });

    expect(log).toEqual(['p-2']);
    gate.resolve();
    await blocked;
  });

  it('rend le resultat et l echec de chaque tache a son appelant', async () => {
    const serializer = new KeyedSerializer();
    const failing = serializer.run('p-1', () => Promise.reject(new Error('refus')));
    const next = serializer.run('p-1', () => Promise.resolve(42));

    await expect(failing).rejects.toThrow('refus');
    // Un echec ne bloque pas la file : la tache suivante tourne quand meme.
    expect(await next).toBe(42);
  });

  it('absorbe une exception levee avant la premiere attente', async () => {
    const serializer = new KeyedSerializer();
    const failing = serializer.run('p-1', () => {
      throw new Error('synchrone');
    });
    await expect(failing).rejects.toThrow('synchrone');
    expect(await serializer.run('p-1', () => Promise.resolve('ok'))).toBe('ok');
  });

  /* Bornee en memoire : une cle n'existe que tant qu'elle a du travail. */
  it('oublie une cle des que sa file se vide', async () => {
    const serializer = new KeyedSerializer();
    const gate = deferred();

    const first = serializer.run('p-1', () => gate.promise);
    const second = serializer.run('p-1', () => Promise.resolve());
    expect(serializer.size).toBe(1);

    gate.resolve();
    await Promise.all([first, second]);
    await settle();
    expect(serializer.size).toBe(0);

    await serializer.run('p-2', () => Promise.reject(new Error('x'))).catch(() => undefined);
    await settle();
    expect(serializer.size).toBe(0);
  });
});
