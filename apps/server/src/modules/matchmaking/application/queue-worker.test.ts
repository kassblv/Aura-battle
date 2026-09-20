import type { ServerMessage, ServerMessageName } from '@aura/protocol';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryQueueStore } from '../adapters/memory-queue.store.js';
import type { MatchOpening, QueueNotifier, RatingReader } from '../domain/ports.js';
import { QueueWorker } from './queue-worker.js';
import { MatchmakingQueue, QUEUE_TICK_MS } from './queue.service.js';

/**
 * Le worker : apparier toutes les 500 ms, puis ouvrir les matchs.
 *
 * Ce qui compte ici n'est pas l'appariement — il est verifie ailleurs, et il
 * est pur — mais la robustesse du tour : il doit survivre a une file muette, a
 * un match qui refuse de s'ouvrir, et ne jamais se superposer a lui-meme.
 */

class SilentNotifier implements QueueNotifier {
  send<N extends ServerMessageName>(_playerId: string, _name: N, _payload: ServerMessage<N>): void {
    // L'etat de la recherche est verifie dans les tests du service.
  }
}

class NoRatings implements RatingReader {
  mmrOf(): Promise<ReadonlyMap<string, number>> {
    return Promise.resolve(new Map());
  }
}

class FakeOpener implements MatchOpening {
  readonly opened: { playerA: string; playerB: string; mode: string }[] = [];
  refuse = false;
  failure: Error | null = null;

  open(request: {
    playerA: string;
    playerB: string;
    mode: 'RANKED' | 'CASUAL';
  }): Promise<string | null> {
    if (this.failure !== null) return Promise.reject(this.failure);
    if (this.refuse) return Promise.resolve(null);
    this.opened.push(request);
    return Promise.resolve(`m_${String(this.opened.length)}`);
  }
}

let store: MemoryQueueStore;
let queue: MatchmakingQueue;
let opener: FakeOpener;
let warnings: string[];
let now: number;

const build = (isAvailable: (playerId: string) => boolean = () => true): QueueWorker =>
  new QueueWorker(queue, opener, { now: () => now }, isAvailable, {
    warn: (message) => warnings.push(message),
  });

beforeEach(() => {
  store = new MemoryQueueStore();
  queue = new MatchmakingQueue(store, store, new NoRatings(), new SilentNotifier());
  opener = new FakeOpener();
  warnings = [];
  now = 10_000;
});

describe('QueueWorker.runOnce', () => {
  it('ouvre un match pour chaque paire formee', async () => {
    await queue.join('p1', 'ranked', 0);
    await queue.join('p2', 'ranked', 1);

    expect(await build().runOnce()).toBe(1);
    expect(opener.opened).toHaveLength(1);
    expect([opener.opened[0]!.playerA, opener.opened[0]!.playerB].sort()).toEqual(['p1', 'p2']);
  });

  it('assoit le plus ancien au siege a', async () => {
    await queue.join('recent', 'ranked', 5_000);
    await queue.join('ancien', 'ranked', 1_000);

    await build().runOnce();

    expect(opener.opened[0]?.playerA).toBe('ancien');
  });

  it('traduit le mode de file en mode de match', async () => {
    await queue.join('p1', 'casual', 0);
    await queue.join('p2', 'casual', 1);

    await build().runOnce();

    expect(opener.opened[0]?.mode).toBe('CASUAL');
  });

  it('n ouvre rien quand personne n attend', async () => {
    expect(await build().runOnce()).toBe(0);
  });

  /** Un joueur passe en duel entre deux tours n'est plus disponible. */
  it('ecarte les joueurs indisponibles', async () => {
    await queue.join('occupe', 'ranked', 0);
    await queue.join('libre', 'ranked', 1);

    expect(await build((id) => id === 'libre').runOnce()).toBe(0);
    expect(await queue.isQueued('occupe')).toBe(false);
  });

  it('signale une paire que le match refuse d ouvrir', async () => {
    opener.refuse = true;
    await queue.join('p1', 'ranked', 0);
    await queue.join('p2', 'ranked', 1);

    expect(await build().runOnce()).toBe(0);
    expect(warnings).toHaveLength(1);
  });

  it('survit a une ouverture qui echoue', async () => {
    opener.failure = new Error('annuaire en feu');
    await queue.join('p1', 'ranked', 0);
    await queue.join('p2', 'ranked', 1);

    await expect(build().runOnce()).resolves.toBe(0);
    expect(warnings).toHaveLength(1);
  });

  /**
   * Une file injoignable ne doit pas tuer le worker : sans lui, plus personne
   * n'est apparie et aucun joueur n'en est averti.
   */
  it('survit a une file injoignable', async () => {
    store.listWaiting = () => Promise.reject(new Error('Redis injoignable'));

    await expect(build().runOnce()).resolves.toBe(0);
    expect(warnings).toHaveLength(1);
  });

  /** Un tour lent ne doit pas voir le suivant lui passer dessus. */
  it('ne superpose pas deux tours', async () => {
    await queue.join('p1', 'ranked', 0);
    await queue.join('p2', 'ranked', 1);

    let release: () => void = () => {
      throw new Error('jamais appele : remplace par la promesse ci-dessous');
    };
    const blocked = new Promise<void>((resolve) => {
      release = resolve;
    });
    opener.open = async (request) => {
      await blocked;
      return `m_${request.playerA}`;
    };

    const worker = build();
    const first = worker.runOnce();
    expect(await worker.runOnce()).toBe(0);

    release();
    expect(await first).toBe(1);
  });
});

describe('QueueWorker — cycle de vie', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('apparie toutes les 500 ms une fois demarre', async () => {
    const worker = build();
    worker.start();

    await queue.join('p1', 'ranked', 0);
    await queue.join('p2', 'ranked', 1);

    await vi.advanceTimersByTimeAsync(QUEUE_TICK_MS + 10);

    expect(opener.opened).toHaveLength(1);
    worker.stop();
  });

  it('n apparie plus rien une fois arrete', async () => {
    const worker = build();
    worker.start();
    worker.stop();

    await queue.join('p1', 'ranked', 0);
    await queue.join('p2', 'ranked', 1);
    await vi.advanceTimersByTimeAsync(10 * QUEUE_TICK_MS);

    expect(opener.opened).toHaveLength(0);
  });

  it('ne demarre qu une fois, meme appele deux fois', async () => {
    const worker = build();
    worker.start();
    worker.start();

    await queue.join('p1', 'ranked', 0);
    await queue.join('p2', 'ranked', 1);
    await vi.advanceTimersByTimeAsync(QUEUE_TICK_MS + 10);

    expect(opener.opened).toHaveLength(1);
    worker.stop();
  });
});
