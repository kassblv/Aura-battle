import { KeyedTokenBuckets, type TokenBucketOptions } from '../../../shared/rate-limit.js';

/**
 * Limite de debit des routes du passe de saison, par joueur (docs/06).
 *
 * Meme raison que `InventoryRateLimit` : chaque appel coute une poignee de
 * requetes SQL, et un compte invite en boucle epuiserait le pool Postgres. La
 * cle est le JOUEUR authentifie.
 *
 * - **Lecture : rafale 10, puis 2 par seconde**, comme l'inventaire : l'ecran
 *   se relit a l'ouverture et apres chaque fin de match.
 * - **Reclamation : rafale 20, puis 4 par seconde.** Un appui par recompense,
 *   c'est le geste que le design veut agreable : quelqu'un qui revient apres
 *   une semaine touche une quinzaine de cases d'affilee. « Tout recuperer »
 *   partage ce seau : c'est la meme ecriture, en lot.
 * - **Premium : rafale 3, puis 1 toutes les 5 secondes.** Un achat unique par
 *   saison ; au-dela du double appui, ce n'est plus un joueur.
 */
export const SEASON_RATE_LIMITS = Object.freeze({
  read: Object.freeze({ capacity: 10, refillPerSecond: 2 }),
  claim: Object.freeze({ capacity: 20, refillPerSecond: 4 }),
  premium: Object.freeze({ capacity: 3, refillPerSecond: 0.2 }),
} satisfies Record<string, TokenBucketOptions>);

export type SeasonRoute = keyof typeof SEASON_RATE_LIMITS;

export class SeasonRateLimit {
  private readonly routes: Readonly<Record<SeasonRoute, KeyedTokenBuckets>> = {
    read: new KeyedTokenBuckets(SEASON_RATE_LIMITS.read),
    claim: new KeyedTokenBuckets(SEASON_RATE_LIMITS.claim),
    premium: new KeyedTokenBuckets(SEASON_RATE_LIMITS.premium),
  };

  /** Consomme un jeton du joueur sur cette route ; `false` : a refuser en 429. */
  allow(route: SeasonRoute, playerId: string, atMs: number): boolean {
    return this.routes[route].tryConsume(playerId, atMs);
  }
}
