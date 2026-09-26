import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import {
  RECENT_OPPONENT_WINDOW_MS,
  type QueueTicketStore,
  type RecentOpponentStore,
} from '../domain/ports.js';
import { DEFAULT_REGION, type QueueTicket } from '../domain/ticket.js';

/**
 * Contrat du rangement de la file, joue sur **chaque** adaptateur.
 *
 * Un double en memoire ne prouve que le double : c'est Redis qui doit retirer
 * deux tickets d'un seul geste, ordonner par anciennete et oublier une
 * rencontre au bout de dix minutes. La meme suite passe donc sur les deux, et
 * une divergence se voit immediatement au lieu d'attendre la production.
 */

export interface StoreUnderTest {
  readonly store: QueueTicketStore & RecentOpponentStore;
  close(): Promise<void>;
}

/** Identifiants neufs a chaque appel : la base Redis de developpement est partagee. */
const newPlayerId = (): string => `mmtest_${randomUUID()}`;

const ticketFor = (playerId: string, over: Partial<QueueTicket> = {}): QueueTicket => ({
  playerId,
  mode: 'ranked',
  mmr: 1000,
  enqueuedAtMs: 1_700_000_000_000,
  region: DEFAULT_REGION,
  recentOpponents: [],
  ...over,
});

export function describeQueueStoreContract(
  label: string,
  open: () => Promise<StoreUnderTest>,
): void {
  describe(`contrat de la file — ${label}`, () => {
    let opened: StoreUnderTest | null = null;

    /** Ouvre une fois, ferme a la fin : une connexion par suite, pas par test. */
    const store = async (): Promise<QueueTicketStore & RecentOpponentStore> => {
      opened ??= await open();
      return opened.store;
    };

    afterAll(async () => {
      await opened?.close();
    });

    it('rend le ticket qu on lui a confie, champ pour champ', async () => {
      const subject = await store();
      const playerId = newPlayerId();
      const ticket = ticketFor(playerId, {
        mmr: 1234,
        mode: 'casual',
        recentOpponents: ['x', 'y'],
      });

      await subject.add(ticket);
      expect(await subject.get(playerId)).toEqual(ticket);

      await subject.remove(playerId);
    });

    it('rend null pour un joueur qui n attend pas', async () => {
      const subject = await store();
      expect(await subject.get(newPlayerId())).toBeNull();
    });

    /**
     * Un joueur qui renvoie `queue:join` en boucle ne doit pas accumuler de
     * tickets : le protocole borne un message, pas la somme des messages.
     */
    it('ne garde qu un ticket par joueur', async () => {
      const subject = await store();
      const playerId = newPlayerId();

      await subject.add(ticketFor(playerId, { enqueuedAtMs: 1_000 }));
      await subject.add(ticketFor(playerId, { enqueuedAtMs: 2_000 }));

      const waiting = (await subject.listWaiting()).filter((t) => t.playerId === playerId);
      expect(waiting).toHaveLength(1);
      expect(waiting[0]!.enqueuedAtMs).toBe(2_000);

      await subject.remove(playerId);
    });

    it('retire un ticket sur demande', async () => {
      const subject = await store();
      const playerId = newPlayerId();

      await subject.add(ticketFor(playerId));
      await subject.remove(playerId);

      expect(await subject.get(playerId)).toBeNull();
      expect((await subject.listWaiting()).map((t) => t.playerId)).not.toContain(playerId);
    });

    it('accepte de retirer un ticket qui n existe plus', async () => {
      const subject = await store();
      await expect(subject.remove(newPlayerId())).resolves.toBeUndefined();
    });

    it('liste les tickets du plus ancien au plus recent', async () => {
      const subject = await store();
      const [tard, tot] = [newPlayerId(), newPlayerId()];

      await subject.add(ticketFor(tard, { enqueuedAtMs: 2_000 }));
      await subject.add(ticketFor(tot, { enqueuedAtMs: 1_000 }));

      const ours = (await subject.listWaiting())
        .map((t) => t.playerId)
        .filter((id) => id === tard || id === tot);
      expect(ours).toEqual([tot, tard]);

      await subject.remove(tard);
      await subject.remove(tot);
    });

    it('retire les deux tickets d une paire reclamee', async () => {
      const subject = await store();
      const [first, second] = [newPlayerId(), newPlayerId()];

      await subject.add(ticketFor(first));
      await subject.add(ticketFor(second));

      expect(await subject.claimPair(first, second)).toBe(true);
      expect(await subject.get(first)).toBeNull();
      expect(await subject.get(second)).toBeNull();
    });

    /**
     * Le cas qui compte : l'un des deux est parti entre la lecture et la
     * reclamation. Retirer l'autre quand meme le sortirait de la file sans lui
     * ouvrir de match — il attendrait devant un ecran que plus rien n'alimente.
     */
    it('ne retire personne quand l un des deux est deja parti', async () => {
      const subject = await store();
      const [present, absent] = [newPlayerId(), newPlayerId()];

      await subject.add(ticketFor(present));

      expect(await subject.claimPair(present, absent)).toBe(false);
      expect(await subject.get(present)).not.toBeNull();

      await subject.remove(present);
    });

    it('ne reclame pas deux fois la meme paire', async () => {
      const subject = await store();
      const [first, second] = [newPlayerId(), newPlayerId()];

      await subject.add(ticketFor(first));
      await subject.add(ticketFor(second));

      expect(await subject.claimPair(first, second)).toBe(true);
      expect(await subject.claimPair(first, second)).toBe(false);
    });

    /**
     * Reclamation d'un seul ticket : c'est la bascule vers un fantome, ou il
     * n'y a personne a reclamer en face (docs/05).
     */
    it('reclame un ticket seul, une seule fois', async () => {
      const subject = await store();
      const playerId = newPlayerId();

      await subject.add(ticketFor(playerId));

      expect(await subject.claim(playerId)).toBe(true);
      expect(await subject.get(playerId)).toBeNull();
      // Deux tours qui se chevauchent : le second ne doit rien obtenir, sinon
      // le meme joueur se voit ouvrir deux matchs.
      expect(await subject.claim(playerId)).toBe(false);
    });

    it('ne reclame pas un ticket qui n a jamais existe', async () => {
      const subject = await store();
      expect(await subject.claim(newPlayerId())).toBe(false);
    });

    it('retient une rencontre dans les deux sens', async () => {
      const subject = await store();
      const [first, second] = [newPlayerId(), newPlayerId()];
      const now = Date.now();

      await subject.record(first, second, now);

      expect(await subject.of(first, now)).toContain(second);
      expect(await subject.of(second, now)).toContain(first);
    });

    /**
     * Passe la fenetre, la rencontre ne compte plus : deux habitues doivent
     * pouvoir se recroiser, sinon la file se fragmente a mesure qu'on joue.
     */
    it('oublie une rencontre sortie de la fenetre', async () => {
      const subject = await store();
      const [first, second] = [newPlayerId(), newPlayerId()];
      const now = Date.now();

      await subject.record(first, second, now);

      expect(await subject.of(first, now + RECENT_OPPONENT_WINDOW_MS + 1)).not.toContain(second);
    });

    it('ne retient rien pour un joueur qui n a jamais joue', async () => {
      const subject = await store();
      expect(await subject.of(newPlayerId(), Date.now())).toEqual([]);
    });
  });
}
