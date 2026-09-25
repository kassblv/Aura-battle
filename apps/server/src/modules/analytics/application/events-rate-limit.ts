import { KeyedTokenBuckets, type TokenBucketOptions } from '../../../shared/rate-limit.js';

/**
 * Limite de debit de `POST /events`, par joueur authentifie (docs/06).
 *
 * Meme mecanisme que les routes de l'inventaire et du passe : chaque appel
 * coute une requete SQL. Un clip se partage au plus une fois par match, et un
 * match dure plus d'une minute : **rafale 5, puis 1 toutes les 5 secondes**
 * laisse passer un double appui, un partage puis un telechargement, et rien
 * de ce qu'un joueur fait sans script.
 */
export const EVENTS_RATE_LIMIT: TokenBucketOptions = Object.freeze({
  capacity: 5,
  refillPerSecond: 0.2,
});

export class EventsRateLimit {
  private readonly buckets = new KeyedTokenBuckets(EVENTS_RATE_LIMIT);

  /** Consomme un jeton du joueur ; `false` : a refuser en 429. */
  allow(playerId: string, atMs: number): boolean {
    return this.buckets.tryConsume(playerId, atMs);
  }
}
