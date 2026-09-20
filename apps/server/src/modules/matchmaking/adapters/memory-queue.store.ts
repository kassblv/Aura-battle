import {
  MAX_RECENT_OPPONENTS,
  RECENT_OPPONENT_WINDOW_MS,
  type QueueTicketStore,
  type RecentOpponentStore,
} from '../domain/ports.js';
import type { QueueTicket } from '../domain/ticket.js';

/**
 * File et memoire des rencontres, en memoire de processus.
 *
 * Deux usages, et un seul non-usage. Elle sert de **reference du contrat** —
 * la meme suite de tests passe sur elle et sur l'adaptateur Redis — et de
 * double dans les tests du service. Elle ne sert pas en production : la file
 * doit survivre a un redemarrage du serveur et se partager entre instances,
 * ce qu'un objet de processus ne fait ni l'un ni l'autre.
 */
export class MemoryQueueStore implements QueueTicketStore, RecentOpponentStore {
  private readonly tickets = new Map<string, QueueTicket>();
  /** Par joueur : l'instant de la derniere rencontre avec chaque adversaire. */
  private readonly recent = new Map<string, Map<string, number>>();

  add(ticket: QueueTicket): Promise<void> {
    // `set` sur une cle existante remplace : un joueur n'a jamais deux tickets.
    this.tickets.set(ticket.playerId, ticket);
    return Promise.resolve();
  }

  get(playerId: string): Promise<QueueTicket | null> {
    return Promise.resolve(this.tickets.get(playerId) ?? null);
  }

  remove(playerId: string): Promise<void> {
    this.tickets.delete(playerId);
    return Promise.resolve();
  }

  listWaiting(): Promise<readonly QueueTicket[]> {
    return Promise.resolve(
      [...this.tickets.values()].sort((left, right) => left.enqueuedAtMs - right.enqueuedAtMs),
    );
  }

  claimPair(firstPlayerId: string, secondPlayerId: string): Promise<boolean> {
    // Les deux, ou aucun : retirer un seul joueur le sortirait de la file sans
    // lui ouvrir de match.
    if (!this.tickets.has(firstPlayerId) || !this.tickets.has(secondPlayerId)) {
      return Promise.resolve(false);
    }
    this.tickets.delete(firstPlayerId);
    this.tickets.delete(secondPlayerId);
    return Promise.resolve(true);
  }

  of(playerId: string, nowMs: number): Promise<readonly string[]> {
    const met = this.recent.get(playerId);
    if (met === undefined) return Promise.resolve([]);

    const floor = nowMs - RECENT_OPPONENT_WINDOW_MS;
    return Promise.resolve(
      [...met]
        .filter(([, atMs]) => atMs >= floor)
        .sort(([, left], [, right]) => right - left)
        .slice(0, MAX_RECENT_OPPONENTS)
        .map(([opponentId]) => opponentId),
    );
  }

  record(firstPlayerId: string, secondPlayerId: string, nowMs: number): Promise<void> {
    this.remember(firstPlayerId, secondPlayerId, nowMs);
    this.remember(secondPlayerId, firstPlayerId, nowMs);
    return Promise.resolve();
  }

  private remember(playerId: string, opponentId: string, nowMs: number): void {
    const met = this.recent.get(playerId) ?? new Map<string, number>();
    met.set(opponentId, nowMs);
    for (const [known, atMs] of met) {
      if (atMs < nowMs - RECENT_OPPONENT_WINDOW_MS) met.delete(known);
    }
    this.recent.set(playerId, met);
  }
}
