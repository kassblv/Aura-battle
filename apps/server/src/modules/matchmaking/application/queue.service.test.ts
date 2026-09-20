import type { ServerMessage, ServerMessageName } from '@aura/protocol';
import { beforeEach, describe, expect, it } from 'vitest';
import { MemoryQueueStore } from '../adapters/memory-queue.store.js';
import type { QueueNotifier, RatingReader } from '../domain/ports.js';
import { DEFAULT_MMR } from '../domain/ticket.js';
import { MatchmakingQueue } from './queue.service.js';

/**
 * File d'attente : entree, sortie, tours d'appariement (docs/05 ; jalon M5).
 *
 * Le temps est un parametre : chaque scenario choisit son instant et verifie
 * la fenetre correspondante sans attendre une seule seconde reelle.
 */

/** Notifier de test : on lit le journal des envois apres coup. */
class RecordingNotifier implements QueueNotifier {
  readonly sent: { playerId: string; name: string; payload: unknown }[] = [];

  send<N extends ServerMessageName>(playerId: string, name: N, payload: ServerMessage<N>): void {
    this.sent.push({ playerId, name, payload });
  }

  statusesFor(playerId: string): ServerMessage<'queue:status'>[] {
    return this.sent
      .filter((m) => m.playerId === playerId && m.name === 'queue:status')
      .map((m) => m.payload as ServerMessage<'queue:status'>);
  }

  lastStatusFor(playerId: string): ServerMessage<'queue:status'> | undefined {
    return this.statusesFor(playerId).at(-1);
  }
}

/** Classements fixes. Un joueur absent de la carte n'a pas de classement. */
class FixedRatings implements RatingReader {
  failure: Error | null = null;

  constructor(private readonly values: Map<string, number> = new Map()) {}

  mmrOf(playerIds: readonly string[], _nowMs: number): Promise<ReadonlyMap<string, number>> {
    if (this.failure !== null) return Promise.reject(this.failure);
    const found = new Map<string, number>();
    for (const id of playerIds) {
      const mmr = this.values.get(id);
      if (mmr !== undefined) found.set(id, mmr);
    }
    return Promise.resolve(found);
  }
}

const TOUS_DISPONIBLES = (): boolean => true;

let store: MemoryQueueStore;
let notifier: RecordingNotifier;
let ratings: FixedRatings;
let queue: MatchmakingQueue;

const withRatings = (values: Record<string, number>): void => {
  ratings = new FixedRatings(new Map(Object.entries(values)));
  queue = new MatchmakingQueue(store, store, ratings, notifier);
};

beforeEach(() => {
  store = new MemoryQueueStore();
  notifier = new RecordingNotifier();
  ratings = new FixedRatings();
  queue = new MatchmakingQueue(store, store, ratings, notifier);
});

describe('queue:join', () => {
  it('cree un ticket avec le MMR lu en base', async () => {
    withRatings({ p1: 1337 });
    const { ticket } = await queue.join('p1', 'ranked', 5_000);

    expect(ticket.mmr).toBe(1337);
    expect(ticket.mode).toBe('ranked');
    expect(ticket.enqueuedAtMs).toBe(5_000);
    expect(await store.get('p1')).toEqual(ticket);
  });

  /** Un joueur sans classement joue quand meme : il part du centre de l'echelle. */
  it('retombe sur le MMR de depart quand le joueur n est pas classe', async () => {
    const { ticket } = await queue.join('p1', 'casual', 0);
    expect(ticket.mmr).toBe(DEFAULT_MMR);
  });

  it('apparie quand meme si le classement est illisible', async () => {
    ratings.failure = new Error('base injoignable');
    const { ticket } = await queue.join('p1', 'ranked', 0);
    expect(ticket.mmr).toBe(DEFAULT_MMR);
  });

  it('annonce tout de suite l etat de la recherche', async () => {
    await queue.join('p1', 'ranked', 5_000);

    expect(notifier.lastStatusFor('p1')).toEqual({
      mode: 'ranked',
      elapsedMs: 0,
      searchRange: 50,
    });
  });

  /**
   * « Le protocole borne un message, pas la somme des messages. » Cent
   * `queue:join` ne font pas cent tickets — ni cent chances d'etre apparie.
   */
  it('n accumule pas de tickets quand le joueur insiste', async () => {
    await queue.join('p1', 'ranked', 1_000);
    for (let i = 0; i < 50; i += 1) {
      await queue.join('p1', 'ranked', 1_000 + i);
    }

    const waiting = await store.listWaiting();
    expect(waiting).toHaveLength(1);
  });

  /** Insister ne doit pas non plus remettre l'attente a zero. */
  it('conserve l anciennete d un joueur qui redemande le meme mode', async () => {
    await queue.join('p1', 'ranked', 1_000);
    const again = await queue.join('p1', 'ranked', 9_000);

    expect(again.resumed).toBe(true);
    expect(again.ticket.enqueuedAtMs).toBe(1_000);
    expect(notifier.lastStatusFor('p1')).toEqual({
      mode: 'ranked',
      elapsedMs: 8_000,
      searchRange: 250,
    });
  });

  it('repart de zero quand le joueur change de mode', async () => {
    await queue.join('p1', 'ranked', 1_000);
    const switched = await queue.join('p1', 'casual', 9_000);

    expect(switched.resumed).toBe(false);
    expect(switched.ticket.mode).toBe('casual');
    expect(switched.ticket.enqueuedAtMs).toBe(9_000);
    expect(await store.listWaiting()).toHaveLength(1);
  });
});

describe('queue:leave', () => {
  it('retire le ticket', async () => {
    await queue.join('p1', 'ranked', 0);
    await queue.leave('p1');

    expect(await queue.isQueued('p1')).toBe(false);
    expect(await store.listWaiting()).toHaveLength(0);
  });

  it('accepte une sortie de file sans ticket', async () => {
    await expect(queue.leave('jamais-entre')).resolves.toBeUndefined();
  });
});

describe('tour d appariement', () => {
  it('marie deux joueurs de MMR proche et les sort de la file', async () => {
    withRatings({ p1: 1000, p2: 1020 });
    await queue.join('p1', 'ranked', 0);
    await queue.join('p2', 'ranked', 0);

    const pairs = await queue.tick(500, TOUS_DISPONIBLES);

    expect(pairs).toHaveLength(1);
    expect([pairs[0]!.a.playerId, pairs[0]!.b.playerId].sort()).toEqual(['p1', 'p2']);
    expect(await store.listWaiting()).toHaveLength(0);
  });

  it('laisse attendre deux joueurs trop eloignes', async () => {
    withRatings({ p1: 1000, p2: 1400 });
    await queue.join('p1', 'ranked', 0);
    await queue.join('p2', 'ranked', 0);

    expect(await queue.tick(500, TOUS_DISPONIBLES)).toHaveLength(0);
    expect(await store.listWaiting()).toHaveLength(2);
  });

  /** L'elargissement finit par les reunir : c'est tout l'objet de la fenetre. */
  it('finit par les marier une fois la fenetre elargie', async () => {
    withRatings({ p1: 1000, p2: 1400 });
    await queue.join('p1', 'ranked', 0);
    await queue.join('p2', 'ranked', 0);

    expect(await queue.tick(10_000, TOUS_DISPONIBLES)).toHaveLength(0);
    expect(await queue.tick(14_000, TOUS_DISPONIBLES)).toHaveLength(1);
  });

  it('ne marie pas un joueur classe avec un joueur en partie rapide', async () => {
    await queue.join('p1', 'ranked', 0);
    await queue.join('p2', 'casual', 0);

    expect(await queue.tick(500, TOUS_DISPONIBLES)).toHaveLength(0);
  });

  it('annonce l attente reelle a ceux qui attendent encore', async () => {
    withRatings({ p1: 1000, p2: 1400 });
    await queue.join('p1', 'ranked', 0);
    await queue.join('p2', 'ranked', 0);

    await queue.tick(3_000, TOUS_DISPONIBLES);

    expect(notifier.lastStatusFor('p1')).toEqual({
      mode: 'ranked',
      elapsedMs: 3_000,
      searchRange: 125,
    });
  });

  it('n annonce plus rien a un joueur qui vient d etre apparie', async () => {
    await queue.join('p1', 'ranked', 0);
    await queue.join('p2', 'ranked', 0);

    await queue.tick(500, TOUS_DISPONIBLES);
    const before = notifier.statusesFor('p1').length;
    await queue.tick(1_000, TOUS_DISPONIBLES);

    expect(notifier.statusesFor('p1')).toHaveLength(before);
  });

  /**
   * Regle d'or n°4 : `queue:status` ne porte que ce qui appartient au
   * destinataire. Ni MMR, ni position dans la file, ni taille de la file — et
   * surtout rien de l'adversaire pressenti.
   */
  it('ne laisse fuir ni MMR ni position dans la file', async () => {
    withRatings({ p1: 1000, p2: 1400 });
    await queue.join('p1', 'ranked', 0);
    await queue.join('p2', 'ranked', 0);
    await queue.tick(3_000, TOUS_DISPONIBLES);

    for (const status of notifier.statusesFor('p1')) {
      expect(Object.keys(status).sort()).toEqual(['elapsedMs', 'mode', 'searchRange']);
    }
  });

  describe('tickets fantomes', () => {
    /**
     * Le defaut le plus couteux de la file : apparier quelqu'un qui n'est plus
     * la. Son adversaire obtiendrait un match contre personne, puis un forfait.
     */
    it('retire le ticket d un joueur qui n est plus connecte', async () => {
      await queue.join('parti', 'ranked', 0);
      await queue.join('present', 'ranked', 0);

      const pairs = await queue.tick(500, (id) => id === 'present');

      expect(pairs).toHaveLength(0);
      expect(await queue.isQueued('parti')).toBe(false);
      expect(await queue.isQueued('present')).toBe(true);
    });

    it('n annonce rien a un joueur qu il vient d ecarter', async () => {
      await queue.join('parti', 'ranked', 0);
      notifier.sent.length = 0;

      await queue.tick(500, () => false);

      expect(notifier.sent).toHaveLength(0);
    });
  });

  describe('adversaires recents', () => {
    it('preserve le souvenir d une rencontre pour le prochain passage en file', async () => {
      await queue.join('p1', 'ranked', 0);
      await queue.join('p2', 'ranked', 0);
      await queue.tick(500, TOUS_DISPONIBLES);

      const { ticket } = await queue.join('p1', 'ranked', 1_000);
      expect(ticket.recentOpponents).toContain('p2');
    });

    it('evite de refaire jouer les memes quand un troisieme attend', async () => {
      withRatings({ p1: 1000, p2: 1000, p3: 1000 });
      await queue.join('p1', 'ranked', 0);
      await queue.join('p2', 'ranked', 0);
      await queue.tick(500, TOUS_DISPONIBLES);

      // Les deux reviennent, un troisieme les rejoint.
      await queue.join('p1', 'ranked', 1_000);
      await queue.join('p2', 'ranked', 1_001);
      await queue.join('p3', 'ranked', 1_002);

      const pairs = await queue.tick(1_500, TOUS_DISPONIBLES);
      expect(pairs).toHaveLength(1);
      expect([pairs[0]!.a.playerId, pairs[0]!.b.playerId]).not.toEqual(
        expect.arrayContaining(['p2']),
      );
    });
  });

  /**
   * Course : le ticket a disparu entre la lecture et la reclamation. On ne
   * doit pas ouvrir de match, et surtout pas sortir l'autre de la file.
   */
  it('renonce a une paire dont un ticket s est evapore', async () => {
    await queue.join('p1', 'ranked', 0);
    await queue.join('p2', 'ranked', 0);

    const honest = store.claimPair.bind(store);
    let firstCall = true;
    store.claimPair = async (first: string, second: string): Promise<boolean> => {
      if (firstCall) {
        firstCall = false;
        await store.remove('p2');
      }
      return honest(first, second);
    };

    const pairs = await queue.tick(500, TOUS_DISPONIBLES);

    expect(pairs).toHaveLength(0);
    expect(await queue.isQueued('p1')).toBe(true);
  });
});
