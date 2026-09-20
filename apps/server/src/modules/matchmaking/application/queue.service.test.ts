import type { ServerMessage, ServerMessageName } from '@aura/protocol';
import { beforeEach, describe, expect, it } from 'vitest';
import { MemoryQueueStore } from '../adapters/memory-queue.store.js';
import type { QueueNotifier, RatingReader } from '../domain/ports.js';
import { DEFAULT_MMR } from '../domain/ticket.js';
import {
  MatchmakingQueue,
  QUEUE_CANCELLATION_MEMORY_MS,
  QUEUE_PARKING_MS,
} from './queue.service.js';

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

  it('retire aussi le ticket quand c est le joueur qui annule', async () => {
    await queue.join('p1', 'ranked', 0);
    await queue.cancel('p1', 1_000);

    expect(await queue.isQueued('p1')).toBe(false);
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

describe('retour en file apres un match non ouvert', () => {
  /**
   * `tick` a deja reclame les deux tickets quand l'ouverture est tentee : si
   * elle echoue, les deux joueurs sont hors de la file **et** sans match. Rien
   * ne les y remettrait, leur minuteur continue de tourner, et ils attendent
   * un appariement qui ne viendra jamais.
   */
  it('remet le ticket en file sans toucher a l anciennete', async () => {
    const { ticket } = await queue.join('p1', 'ranked', 1_000);
    await queue.join('p2', 'ranked', 1_000);
    // Le tour reclame les deux tickets : les voila hors de la file, en attente
    // d'une ouverture qui, ici, n'aboutit pas.
    await queue.tick(2_000, TOUS_DISPONIBLES);
    expect(await queue.isQueued('p1')).toBe(false);

    await queue.requeue(ticket, 5_000);

    expect((await store.get('p1'))?.enqueuedAtMs).toBe(1_000);
  });

  /**
   * L'anciennete est conservee parce que la faute n'est pas celle du joueur
   * remis en file : c'est son adversaire qui s'est assis ailleurs. Repartir au
   * bout de la queue lui couterait sa fenetre de recherche elargie.
   */
  it('annonce une attente qui continue, pas une recherche qui redemarre', async () => {
    const { ticket } = await queue.join('p1', 'ranked', 1_000);
    await queue.join('p2', 'ranked', 1_000);
    await queue.tick(2_000, TOUS_DISPONIBLES);
    notifier.sent.length = 0;

    await queue.requeue(ticket, 11_000);

    expect(notifier.lastStatusFor('p1')).toEqual({
      mode: 'ranked',
      elapsedMs: 10_000,
      searchRange: 300,
    });
  });

  /**
   * Le cas qui coute une defaite au classement.
   *
   * Le tour reclame les deux tickets, PUIS le joueur annule : `leave` ne
   * trouve plus rien a retirer et ne laisse aucune trace. Si `requeue` le
   * remet en file, il redevient appariable — et son client, qui a quitte
   * l'ecran de recherche, encaisse le `match:found` suivant sans le jouer :
   * trois manches d'actions par defaut, puis une defaite classee sur une
   * recherche qu'il avait annulee.
   */
  it('ne remet pas en file un joueur qui vient d annuler sa recherche', async () => {
    const { ticket } = await queue.join('p1', 'ranked', 1_000);
    await queue.join('p2', 'ranked', 1_000);
    await queue.tick(2_000, TOUS_DISPONIBLES);

    await queue.cancel('p1', 2_001);
    notifier.sent.length = 0;
    await queue.requeue(ticket, 2_002);

    expect(await queue.isQueued('p1')).toBe(false);
    // Et rien ne lui laisse croire qu'il cherche encore.
    expect(notifier.statusesFor('p1')).toHaveLength(0);
  });

  /** L'annulation ne vaut que pour elle-meme : redemander efface tout. */
  it('remet en file un joueur qui a annule puis redemande un duel', async () => {
    await queue.join('p1', 'ranked', 1_000);
    await queue.join('p2', 'ranked', 1_000);
    await queue.tick(2_000, TOUS_DISPONIBLES);
    await queue.cancel('p1', 2_001);

    const { ticket } = await queue.join('p1', 'ranked', 3_000);
    await queue.join('p3', 'ranked', 3_000);
    await queue.tick(4_000, TOUS_DISPONIBLES);
    await queue.requeue(ticket, 4_001);

    expect(await queue.isQueued('p1')).toBe(true);
  });

  /** La memoire des annulations est bornee : elle ne vit qu'un tour. */
  it('oublie les annulations que plus aucun tour ne peut concerner', async () => {
    const { ticket } = await queue.join('p1', 'ranked', 1_000);
    await queue.join('p2', 'ranked', 1_000);
    await queue.tick(2_000, TOUS_DISPONIBLES);
    await queue.cancel('p1', 2_001);

    await queue.tick(2_001 + QUEUE_CANCELLATION_MEMORY_MS, TOUS_DISPONIBLES);
    await queue.requeue(ticket, 2_002 + QUEUE_CANCELLATION_MEMORY_MS);

    expect(await queue.isQueued('p1')).toBe(true);
  });

  /** Un ticket plus recent a ete ecrit entre-temps : il gagne. */
  it('n ecrase pas un ticket que le joueur a redemande depuis', async () => {
    const { ticket } = await queue.join('p1', 'ranked', 1_000);
    await queue.join('p2', 'ranked', 1_000);
    await queue.tick(2_000, TOUS_DISPONIBLES);
    await queue.join('p1', 'casual', 9_000);

    await queue.requeue(ticket, 9_500);

    expect((await store.get('p1'))?.mode).toBe('casual');
  });
});

describe('deconnexion pendant l attente', () => {
  /**
   * Un ticket gare n'est plus appariable, mais il n'est pas perdu.
   *
   * docs/03 demande au client de **fermer sa socket** quand l'application
   * passe en arriere-plan et de revenir ensuite ; il accorde 45 s pour
   * reprendre un match en cours. Une file plus severe que cela punirait le
   * comportement que le protocole prescrit : passer sous un tunnel ferait
   * perdre sa place, sans que rien ne le dise au joueur.
   *
   * Pendant ce temps il n'apparait dans aucun tour d'appariement : l'invariant
   * « on n'apparie jamais un absent » tient toujours.
   */
  it('garde le ticket hors de la file tant que le joueur est absent', async () => {
    await queue.join('parti', 'ranked', 0);
    await queue.join('present', 'ranked', 0);

    await queue.park('parti', 1_000);

    expect(await queue.tick(1_500, TOUS_DISPONIBLES)).toHaveLength(0);
    expect(await queue.isQueued('parti')).toBe(false);
  });

  it('rend sa place et son anciennete au joueur qui revient', async () => {
    await queue.join('p1', 'ranked', 1_000);
    await queue.park('p1', 2_000);

    expect(await queue.resume('p1', 12_000)).toBe(true);
    expect((await store.get('p1'))?.enqueuedAtMs).toBe(1_000);
    expect(notifier.lastStatusFor('p1')).toEqual({
      mode: 'ranked',
      elapsedMs: 11_000,
      searchRange: 325,
    });
  });

  /** Au-dela de la grace, le ticket n'existe plus : rien a reprendre. */
  it('ne rend rien passe le delai de grace', async () => {
    await queue.join('p1', 'ranked', 1_000);
    await queue.park('p1', 2_000);

    expect(await queue.resume('p1', 2_000 + QUEUE_PARKING_MS + 1)).toBe(false);
    expect(await queue.isQueued('p1')).toBe(false);
    expect(notifier.statusesFor('p1')).toHaveLength(1);
  });

  it('ne rend rien a un joueur qui n attendait pas', async () => {
    expect(await queue.resume('jamais-entre', 1_000)).toBe(false);
  });

  /**
   * Une sortie volontaire est definitive : sans cela, un joueur qui annule sa
   * recherche puis se reconnecte se retrouverait a chercher un duel qu'il
   * n'a plus demande.
   */
  it('oublie le ticket gare quand le joueur quitte la file', async () => {
    await queue.join('p1', 'ranked', 1_000);
    await queue.park('p1', 2_000);
    await queue.cancel('p1', 2_500);

    expect(await queue.resume('p1', 3_000)).toBe(false);
  });

  it('reprend l anciennete garee quand c est le client qui redemande', async () => {
    await queue.join('p1', 'ranked', 1_000);
    await queue.park('p1', 2_000);

    const again = await queue.join('p1', 'ranked', 12_000);

    expect(again.resumed).toBe(true);
    expect(again.ticket.enqueuedAtMs).toBe(1_000);
    expect(await queue.isQueued('p1')).toBe(true);
  });

  it('repart de zero quand le joueur revient dans un autre mode', async () => {
    await queue.join('p1', 'ranked', 1_000);
    await queue.park('p1', 2_000);

    const again = await queue.join('p1', 'casual', 12_000);

    expect(again.resumed).toBe(false);
    expect(again.ticket.enqueuedAtMs).toBe(12_000);
    expect(await queue.resume('p1', 12_001)).toBe(false);
  });

  /** Les tickets de ceux qui ne reviennent jamais ne doivent pas s'entasser. */
  it('oublie les tickets gares dont la grace a expire', async () => {
    await queue.join('p1', 'ranked', 0);
    await queue.park('p1', 0);

    await queue.tick(QUEUE_PARKING_MS + 1, TOUS_DISPONIBLES);

    expect(await queue.resume('p1', QUEUE_PARKING_MS + 2)).toBe(false);
  });

  it('accepte de garer un joueur qui n a pas de ticket', async () => {
    await expect(queue.park('jamais-entre', 1_000)).resolves.toBeUndefined();
  });
});
