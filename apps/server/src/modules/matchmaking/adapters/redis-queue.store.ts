import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { RedisClient } from '../../../shared/redis.js';
import {
  MAX_RECENT_OPPONENTS,
  RECENT_OPPONENT_WINDOW_MS,
  type QueueTicketStore,
  type RecentOpponentStore,
} from '../domain/ports.js';
import type { QueueTicket } from '../domain/ticket.js';

/**
 * File d'attente dans Redis (docs/05, § « File d'attente »).
 *
 * Trois formes de donnees, une par question posee :
 *
 * - `mm:queue` — ensemble trie, score = heure d'entree. L'ordre d'anciennete
 *   demande par docs/05 est alors celui de Redis, pas un tri qu'on refait.
 * - `mm:ticket:<joueur>` — le ticket serialise, avec une duree de vie. C'est
 *   le filet contre les tickets fantomes : meme si un serveur meurt entre le
 *   `queue:join` et la deconnexion, le ticket finit par disparaitre.
 * - `mm:recent:<joueur>` — ensemble trie, score = heure de la rencontre. Une
 *   fenetre glissante de dix minutes se lit alors par plage de score.
 *
 * L'appariement, lui, n'est pas ici : il est pur et vit dans `domain/pairing`.
 *
 * **Chaque ticket porte l'instance qui l'a ecrit.** Un serveur ne lit que ses
 * propres tickets, parce qu'il ne peut notifier que ses propres joueurs : son
 * registre de sockets est local au processus. Sans ce marquage, deux instances
 * branchees sur le meme Redis se detruisent mutuellement leurs files — chacune
 * voit les joueurs de l'autre comme deconnectes et retire leurs tickets. Ce
 * n'est pas une hypothese : c'est ce qui se produit des qu'un second `pnpm dev`
 * tourne sur la meme machine.
 *
 * L'identite d'instance vit **ici**, dans l'adaptateur, et pas dans le ticket
 * du domaine : l'appariement n'a pas a savoir qu'il existe plusieurs serveurs.
 */

const QUEUE_KEY = 'mm:queue';
const ticketKey = (playerId: string): string => `mm:ticket:${playerId}`;
const recentKey = (playerId: string): string => `mm:recent:${playerId}`;

/**
 * Duree de vie d'un ticket, en secondes.
 *
 * Genereuse a dessein : ce n'est pas la duree d'attente attendue, c'est la
 * borne au-dela de laquelle on considere qu'un ticket a perdu son joueur. Les
 * trois chemins normaux — `queue:leave`, deconnexion, ouverture de match — le
 * retirent bien avant.
 */
const TICKET_TTL_SECONDS = 30 * 60;

/**
 * Ce que Redis rend, relu comme une entree etrangere.
 *
 * Ces octets ont pu etre ecrits par une autre version du serveur, ou par
 * n'importe qui ayant acces a l'instance. Un ticket qui ne passe pas ce schema
 * est traite comme absent, et son entree de file est nettoyee — plutot que de
 * faire trebucher l'appariement de tous les autres joueurs.
 */
const storedTicketSchema = z.strictObject({
  /** Instance qui a ecrit ce ticket, et seule a pouvoir joindre son joueur. */
  nodeId: z.string().min(1).max(64),
  playerId: z.string().min(1).max(64),
  mode: z.enum(['ranked', 'casual']),
  mmr: z.number().finite(),
  enqueuedAtMs: z.number().int().nonnegative(),
  region: z.string().min(1).max(32),
  recentOpponents: z.array(z.string().min(1).max(64)).max(MAX_RECENT_OPPONENTS),
});

/**
 * Reclamation d'une paire, en un seul aller-retour atomique.
 *
 * Un script Lua s'execute sans entrelacement : la verification et le retrait
 * ne peuvent pas etre separes par un autre client. Verifier d'abord, retirer
 * ensuite, evite le cas ou le premier `ZREM` reussit et le second echoue — le
 * premier joueur aurait alors quitte la file sans obtenir de match.
 */
const CLAIM_PAIR_SCRIPT = `
local first = redis.call('ZSCORE', KEYS[1], ARGV[1])
local second = redis.call('ZSCORE', KEYS[1], ARGV[2])
if first and second then
  redis.call('ZREM', KEYS[1], ARGV[1], ARGV[2])
  redis.call('DEL', KEYS[2], KEYS[3])
  return 1
end
return 0
`;

export class RedisQueueStore implements QueueTicketStore, RecentOpponentStore {
  constructor(
    private readonly client: RedisClient,
    /** Identite de cette instance. Neuve a chaque demarrage, et c'est voulu :
     * les tickets d'un serveur mort ne sont plus joignables par personne. */
    private readonly nodeId: string = randomUUID(),
  ) {}

  /**
   * Ajoute ou **remplace** le ticket d'un joueur.
   *
   * `ZADD` sur un membre existant met le score a jour sans creer de doublon :
   * un joueur qui envoie cent `queue:join` occupe une place, pas cent.
   */
  async add(ticket: QueueTicket): Promise<void> {
    await this.client
      .multi()
      .zAdd(QUEUE_KEY, { score: ticket.enqueuedAtMs, value: ticket.playerId })
      .set(ticketKey(ticket.playerId), JSON.stringify({ ...ticket, nodeId: this.nodeId }), {
        EX: TICKET_TTL_SECONDS,
      })
      .exec();
  }

  async get(playerId: string): Promise<QueueTicket | null> {
    const stored = this.parse(await this.client.get(ticketKey(playerId)));
    return stored?.nodeId === this.nodeId ? stored.ticket : null;
  }

  async remove(playerId: string): Promise<void> {
    await this.client.multi().zRem(QUEUE_KEY, playerId).del(ticketKey(playerId)).exec();
  }

  /**
   * Tickets en attente, du plus ancien au plus recent.
   *
   * Une entree de file dont le ticket a expire est retiree au passage : sans ce
   * nettoyage, l'ensemble trie grossirait indefiniment avec les joueurs d'hier.
   */
  async listWaiting(): Promise<readonly QueueTicket[]> {
    const playerIds = await this.client.zRange(QUEUE_KEY, 0, -1);
    if (playerIds.length === 0) return [];

    const stored = await this.client.mGet(playerIds.map(ticketKey));
    const tickets: QueueTicket[] = [];
    const stale: string[] = [];

    playerIds.forEach((playerId, index) => {
      const entry = this.parse(stored[index] ?? null);
      if (entry === null) {
        // Plus de ticket derriere cette place : elle ne vaut plus rien, quelle
        // que soit l'instance qui l'avait ecrite.
        stale.push(playerId);
        return;
      }
      if (entry.nodeId !== this.nodeId || entry.ticket.playerId !== playerId) return;
      tickets.push(entry.ticket);
    });

    if (stale.length > 0) {
      await this.client.multi().zRem(QUEUE_KEY, stale).del(stale.map(ticketKey)).exec();
    }

    return tickets;
  }

  async claimPair(firstPlayerId: string, secondPlayerId: string): Promise<boolean> {
    const claimed = await this.client.eval(CLAIM_PAIR_SCRIPT, {
      keys: [QUEUE_KEY, ticketKey(firstPlayerId), ticketKey(secondPlayerId)],
      arguments: [firstPlayerId, secondPlayerId],
    });
    return claimed === 1;
  }

  async of(playerId: string, nowMs: number): Promise<readonly string[]> {
    const key = recentKey(playerId);
    // Par score croissant : les derniers de la liste sont les rencontres les
    // plus recentes, et ce sont elles qu'on garde.
    const met = await this.client.zRangeByScore(key, nowMs - RECENT_OPPONENT_WINDOW_MS, '+inf');
    return met.slice(-MAX_RECENT_OPPONENTS);
  }

  async record(firstPlayerId: string, secondPlayerId: string, nowMs: number): Promise<void> {
    await this.rememberPair(firstPlayerId, secondPlayerId, nowMs);
    await this.rememberPair(secondPlayerId, firstPlayerId, nowMs);
  }

  private async rememberPair(playerId: string, opponentId: string, nowMs: number): Promise<void> {
    const key = recentKey(playerId);
    await this.client
      .multi()
      .zAdd(key, { score: nowMs, value: opponentId })
      // Les rencontres sorties de la fenetre partent tout de suite : la duree
      // de vie de la cle ne fait que ramasser ce qui reste.
      .zRemRangeByScore(key, '-inf', nowMs - RECENT_OPPONENT_WINDOW_MS)
      .expire(key, Math.ceil(RECENT_OPPONENT_WINDOW_MS / 1_000))
      .exec();
  }

  /** Un ticket illisible vaut un ticket absent. */
  private parse(raw: string | null): { nodeId: string; ticket: QueueTicket } | null {
    if (raw === null) return null;
    try {
      const parsed = storedTicketSchema.safeParse(JSON.parse(raw));
      if (!parsed.success) return null;
      const { nodeId, ...ticket } = parsed.data;
      return { nodeId, ticket };
    } catch {
      // JSON invalide : meme conclusion, sans faire tomber le tour d'appariement.
      return null;
    }
  }
}
