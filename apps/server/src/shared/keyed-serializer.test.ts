import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { KeyedSerializer, KeyedSerializerFullError } from './keyed-serializer.js';

/** Une promesse qu'on resout a la main, pour choisir l'ordre des fins. */
function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

/** Une tache qui ne se termine jamais : la requete partie vers une base muette. */
const never = (): Promise<never> => new Promise<never>(() => undefined);

/** Laisse s'ecouler toutes les microtaches en attente, sans avancer l'horloge. */
const settle = () => vi.advanceTimersByTimeAsync(0);

const RELEASE_AFTER_MS = 1_000;
const MAX_DEPTH = 4;

function serializer(onOverdue?: () => void): KeyedSerializer {
  return new KeyedSerializer({
    maxDepth: MAX_DEPTH,
    releaseAfterMs: RELEASE_AFTER_MS,
    ...(onOverdue === undefined ? {} : { onOverdue }),
  });
}

describe('KeyedSerializer', () => {
  beforeEach(() => {
    // Seuls les minuteurs sont simules : `setImmediate` et les microtaches
    // restent reels, sans quoi rien n'avancerait entre deux assertions.
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('execute les taches d une meme cle l une apres l autre, dans l ordre d arrivee', async () => {
    const queue = serializer();
    const gate = deferred();
    const log: string[] = [];

    const first = queue.run('p-1', async () => {
      log.push('debut 1');
      await gate.promise;
      log.push('fin 1');
    });
    const second = queue.run('p-1', () => {
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
    const queue = serializer();
    const gate = deferred();
    const log: string[] = [];

    const blocked = queue.run('p-1', () => gate.promise);
    await queue.run('p-2', () => {
      log.push('p-2');
      return Promise.resolve();
    });

    expect(log).toEqual(['p-2']);
    gate.resolve();
    await blocked;
  });

  it('rend le resultat et l echec de chaque tache a son appelant', async () => {
    const queue = serializer();
    const failing = queue.run('p-1', () => Promise.reject(new Error('refus')));
    const next = queue.run('p-1', () => Promise.resolve(42));

    await expect(failing).rejects.toThrow('refus');
    // Un echec ne bloque pas la file : la tache suivante tourne quand meme.
    expect(await next).toBe(42);
  });

  it('absorbe une exception levee avant la premiere attente', async () => {
    const queue = serializer();
    const failing = queue.run('p-1', () => {
      throw new Error('synchrone');
    });
    await expect(failing).rejects.toThrow('synchrone');
    expect(await queue.run('p-1', () => Promise.resolve('ok'))).toBe('ok');
  });

  /* Bornee en memoire : une cle n'existe que tant qu'elle a du travail. */
  it('oublie une cle des que sa file se vide', async () => {
    const queue = serializer();
    const gate = deferred();

    const first = queue.run('p-1', () => gate.promise);
    const second = queue.run('p-1', () => Promise.resolve());
    expect(queue.size).toBe(1);

    gate.resolve();
    await Promise.all([first, second]);
    await settle();
    expect(queue.size).toBe(0);

    await queue.run('p-2', () => Promise.reject(new Error('x'))).catch(() => undefined);
    await settle();
    expect(queue.size).toBe(0);
  });

  describe('une tache qui ne se termine jamais', () => {
    /*
      La panne d'origine : une coupure silencieuse vers Postgres laissait une
      requete pendante, et tous les achats et equipements suivants du joueur
      attendaient derriere elle, pour toujours.
    */
    it('cede la file a la suivante une fois le delai ecoule', async () => {
      const queue = serializer();
      const log: string[] = [];

      const stuck = queue.run('p-1', never);
      const next = queue.run('p-1', () => {
        log.push('suivante');
        return Promise.resolve('ok');
      });

      await vi.advanceTimersByTimeAsync(RELEASE_AFTER_MS - 1);
      expect(log).toEqual([]);

      await vi.advanceTimersByTimeAsync(1);
      expect(log).toEqual(['suivante']);
      expect(await next).toBe('ok');

      // La tache pendante reste celle de son appelant : on ne lui invente pas
      // d'echec, c'est a la base (et a ses propres delais) de la conclure.
      let stuckSettled = false;
      void stuck.then(
        () => (stuckSettled = true),
        () => (stuckSettled = true),
      );
      await settle();
      expect(stuckSettled).toBe(false);
    });

    it('compte le delai depuis le debut de la tache, pas depuis son arrivee', async () => {
      const queue = serializer();
      const log: string[] = [];

      void queue.run('p-1', () => new Promise<void>((done) => setTimeout(done, 800)));
      void queue.run('p-1', never);
      void queue.run('p-1', () => {
        log.push('troisieme');
        return Promise.resolve();
      });

      // La deuxieme a commence a 800 ms : elle garde la file jusqu'a 1 800 ms.
      await vi.advanceTimersByTimeAsync(800 + RELEASE_AFTER_MS - 1);
      expect(log).toEqual([]);
      await vi.advanceTimersByTimeAsync(1);
      expect(log).toEqual(['troisieme']);
    });

    it('ne relache pas l ordre d une tache qui aboutit avant le delai', async () => {
      const queue = serializer();
      const log: string[] = [];

      void queue.run('p-1', async () => {
        await new Promise<void>((done) => setTimeout(done, RELEASE_AFTER_MS - 1));
        log.push('fin 1');
      });
      void queue.run('p-1', () => {
        log.push('debut 2');
        return Promise.resolve();
      });

      await vi.advanceTimersByTimeAsync(RELEASE_AFTER_MS * 3);
      expect(log).toEqual(['fin 1', 'debut 2']);
    });

    it('signale chaque depassement, et seulement les depassements', async () => {
      const overdue = vi.fn();
      const queue = serializer(overdue);

      await queue.run('p-1', () => Promise.resolve());
      void queue.run('p-1', never);
      await vi.advanceTimersByTimeAsync(RELEASE_AFTER_MS);

      expect(overdue).toHaveBeenCalledTimes(1);
    });

    it('oublie la cle quand la file se vide, meme si la tache pend encore', async () => {
      const queue = serializer();
      const late = deferred();

      const stuck = queue.run('p-1', () => late.promise);
      await vi.advanceTimersByTimeAsync(RELEASE_AFTER_MS);
      expect(queue.size).toBe(0);

      // Sa fin tardive ne derange ni la cle, ni une file repartie depuis.
      const gate = deferred();
      const fresh = queue.run('p-1', () => gate.promise);
      late.resolve();
      await stuck;
      await settle();
      expect(queue.size).toBe(1);
      gate.resolve();
      await fresh;
      await settle();
      expect(queue.size).toBe(0);
    });
  });

  describe('profondeur par cle', () => {
    it('refuse la tache de trop, sans l executer', async () => {
      const queue = serializer();
      const ran = vi.fn(() => Promise.resolve());

      for (let i = 0; i < MAX_DEPTH; i += 1) void queue.run('p-1', never);
      const refused = queue.run('p-1', ran);

      await expect(refused).rejects.toBeInstanceOf(KeyedSerializerFullError);
      await vi.advanceTimersByTimeAsync(RELEASE_AFTER_MS * (MAX_DEPTH + 1));
      expect(ran).not.toHaveBeenCalled();
    });

    it('accepte a nouveau des qu une place se libere', async () => {
      const queue = serializer();
      const first = deferred();

      void queue.run('p-1', () => first.promise);
      for (let i = 1; i < MAX_DEPTH; i += 1) void queue.run('p-1', never);
      await expect(queue.run('p-1', () => Promise.resolve())).rejects.toBeInstanceOf(
        KeyedSerializerFullError,
      );

      first.resolve();
      await settle();
      const accepted = queue.run('p-1', () => Promise.resolve('ok'));
      // Trois taches pendantes devant elle, chacune rendue au bout du delai.
      await vi.advanceTimersByTimeAsync(RELEASE_AFTER_MS * (MAX_DEPTH - 1));
      expect(await accepted).toBe('ok');
    });

    it('libere la place d une tache pendante au bout du delai', async () => {
      const queue = serializer();

      for (let i = 0; i < MAX_DEPTH; i += 1) void queue.run('p-1', never);
      await vi.advanceTimersByTimeAsync(RELEASE_AFTER_MS);

      // Une place rendue, pas davantage : trois taches gardent encore la file.
      const accepted = queue.run('p-1', () => Promise.resolve('ok'));
      await expect(queue.run('p-1', () => Promise.resolve())).rejects.toBeInstanceOf(
        KeyedSerializerFullError,
      );
      await vi.advanceTimersByTimeAsync(RELEASE_AFTER_MS * (MAX_DEPTH - 1));
      expect(await accepted).toBe('ok');
    });

    it('ne retarde jamais un autre joueur, meme file pleine et pendante', async () => {
      const queue = serializer();

      for (let i = 0; i < MAX_DEPTH; i += 1) void queue.run('p-1', never);
      await expect(queue.run('p-1', () => Promise.resolve())).rejects.toBeInstanceOf(
        KeyedSerializerFullError,
      );

      // Sans avancer l'horloge d'une milliseconde.
      expect(await queue.run('p-2', () => Promise.resolve('p-2'))).toBe('p-2');
      for (let i = 1; i < MAX_DEPTH; i += 1) void queue.run('p-2', () => Promise.resolve());
      expect(await queue.run('p-2', () => Promise.resolve('encore'))).toBe('encore');
    });
  });

  it('refuse des bornes qui n en sont pas', () => {
    expect(() => new KeyedSerializer({ maxDepth: 0, releaseAfterMs: 1_000 })).toThrow(RangeError);
    expect(() => new KeyedSerializer({ maxDepth: 1.5, releaseAfterMs: 1_000 })).toThrow(RangeError);
    expect(() => new KeyedSerializer({ maxDepth: 4, releaseAfterMs: 0 })).toThrow(RangeError);
  });
});
