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
  /** Refuse d'ouvrir, en produisant au passage la cause du refus. */
  refuseWith: (() => void) | null = null;

  open(request: { playerA: string; playerB: string; mode: 'RANKED' | 'CASUAL' }): string | null {
    if (this.failure !== null) throw this.failure;
    if (this.refuseWith !== null) {
      this.refuseWith();
      return null;
    }
    if (this.refuse) return null;
    this.opened.push(request);
    return `m_${String(this.opened.length)}`;
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
    // Deux lignes : la panne, puis le retour en file des deux joueurs.
    expect(warnings.join(' ')).toContain('annuaire en feu');
  });

  /**
   * Ne recopie jamais la cause brute dans un journal.
   *
   * `String(cause)` rend « nom: message », et le message d'une erreur ecrite
   * par une bibliotheque recopie volontiers les arguments qu'elle a refuses.
   * Le resume partage ne garde que le nom et la premiere ligne.
   */
  it('resume la cause d une ouverture ratee sans la recopier', async () => {
    opener.failure = new Error('echec\n  playerId: "p1",\n  seed: "graine"');
    await queue.join('p1', 'ranked', 0);
    await queue.join('p2', 'ranked', 1);

    await build().runOnce();

    expect(warnings.join(' ')).not.toContain('graine');
  });

  /**
   * Le tour a **deja** reclame les deux tickets quand il tente d'ouvrir : une
   * ouverture refusee laisse donc deux joueurs hors de la file et sans match.
   * Personne ne les apparie plus, leur minuteur continue de tourner, et rien
   * ne le leur dit — jusqu'a ce qu'ils relancent l'application.
   */
  it('remet en file les joueurs d une paire que le match refuse d ouvrir', async () => {
    opener.refuse = true;
    await queue.join('p1', 'ranked', 0);
    await queue.join('p2', 'ranked', 1);

    await build().runOnce();

    expect((await store.listWaiting()).map((t) => t.playerId).sort()).toEqual(['p1', 'p2']);
  });

  it('remet aussi en file apres une ouverture qui a jete', async () => {
    opener.failure = new Error('annuaire en feu');
    await queue.join('p1', 'ranked', 0);
    await queue.join('p2', 'ranked', 1);

    await build().runOnce();

    expect(await store.listWaiting()).toHaveLength(2);
  });

  /**
   * L'anciennete ne se perd pas dans l'operation : le joueur remis en file n'a
   * rien fait de mal, et repartir au bout de la queue lui couterait la fenetre
   * de recherche qu'il avait elargie en patientant.
   */
  it('leur rend leur anciennete, pas une place en fin de queue', async () => {
    opener.refuse = true;
    await queue.join('ancien', 'ranked', 1_000);
    await queue.join('recent', 'ranked', 2_000);

    now = 30_000;
    await build().runOnce();

    const waiting = await store.listWaiting();
    expect(waiting.map((t) => t.enqueuedAtMs)).toEqual([1_000, 2_000]);
  });

  /**
   * Le cas qui produit le defaut : celui des deux qui vient de s'asseoir
   * ailleurs — une invitation acceptee pendant l'attente — fait echouer
   * l'ouverture. Lui n'a rien a faire en file ; sa victime, si.
   */
  it('ne remet pas en file celui qui est parti s asseoir ailleurs', async () => {
    await queue.join('assis', 'ranked', 0);
    await queue.join('victime', 'ranked', 1);

    // Il etait libre quand le tour l'a apparie, et occupe quand le match a
    // tente de s'ouvrir : c'est exactement ce qu'une invitation acceptee
    // pendant l'attente produit.
    let seated = false;
    opener.refuseWith = () => {
      seated = true;
    };

    await build((id) => !(id === 'assis' && seated)).runOnce();

    expect((await store.listWaiting()).map((t) => t.playerId)).toEqual(['victime']);
  });

  /**
   * L'annulation qui arrive pile entre la reclamation et l'ouverture ratee.
   *
   * C'est la sequence complete, au niveau ou elle se produit : le tour reclame
   * les deux tickets, le joueur envoie `queue:leave` pendant que l'ouverture
   * echoue, et il ne doit PAS revenir en file — sinon il redevient appariable
   * alors que son client a quitte l'ecran de recherche, et la partie suivante
   * se joue sans lui.
   */
  it('ne ramene pas en file un joueur qui a annule pendant l ouverture', async () => {
    await queue.join('annule', 'ranked', 0);
    await queue.join('autre', 'ranked', 1);

    opener.refuseWith = () => {
      // Comme la passerelle : l'annulation est inscrite tout de suite, meme si
      // le retrait du ticket, lui, se termine plus tard.
      void queue.cancel('annule', now);
    };

    await build().runOnce();

    expect((await store.listWaiting()).map((t) => t.playerId)).toEqual(['autre']);
  });

  /** Une file injoignable au retour ne doit pas arreter le tour suivant. */
  it('survit a un retour en file impossible', async () => {
    opener.refuse = true;
    await queue.join('p1', 'ranked', 0);
    await queue.join('p2', 'ranked', 1);
    store.add = () => Promise.reject(new Error('Redis injoignable'));

    await expect(build().runOnce()).resolves.toBe(0);
  });

  /**
   * La question qu'on se pose a chaque tour : un joueur peut-il sortir deux
   * fois de la meme salve ? Non — un ticket par joueur dans le rangement, et
   * un index reclame au plus une fois par `pairTickets`.
   */
  it('ne sort jamais le meme joueur dans deux paires du meme tour', async () => {
    for (let i = 0; i < 8; i += 1) {
      await queue.join(`p${String(i)}`, 'ranked', i);
    }

    await build().runOnce();

    const seated = opener.opened.flatMap((m) => [m.playerA, m.playerB]);
    expect(new Set(seated).size).toBe(seated.length);
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

  /**
   * Un tour lent ne doit pas voir le suivant lui passer dessus.
   *
   * L'ouverture est synchrone, mais la lecture de la file ne l'est pas : c'est
   * la que deux tours peuvent se chevaucher, et se chevaucher voudrait dire
   * lire deux fois les memes tickets avant de les avoir reclames.
   */
  it('ne superpose pas deux tours', async () => {
    await queue.join('p1', 'ranked', 0);
    await queue.join('p2', 'ranked', 1);

    let release: () => void = () => {
      throw new Error('jamais appele : remplace par la promesse ci-dessous');
    };
    const blocked = new Promise<void>((resolve) => {
      release = resolve;
    });
    const honest = store.listWaiting.bind(store);
    store.listWaiting = async () => {
      await blocked;
      return honest();
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
