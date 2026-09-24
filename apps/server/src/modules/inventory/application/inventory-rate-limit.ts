import { KeyedTokenBuckets, type TokenBucketOptions } from '../../../shared/rate-limit.js';

/**
 * Limite de debit des ecritures d'inventaire, par joueur (docs/06).
 *
 * Chaque ecriture coute des requetes SQL — quatre pour un equipement, sept ou
 * huit pour un achat (lecture, puis debit et accord en transaction). Sans
 * borne, un compte invite en boucle epuise le pool Postgres et le jeu entier
 * attend. La cle est le JOUEUR authentifie : l'IP punirait tout un reseau
 * d'operateur, et la connexion n'existe pas en HTTP.
 *
 * Bornes, choisies d'apres le client (`apps/mobile`), pas d'apres une
 * intuition :
 *
 * - **Equipement : rafale 12, puis 2 par seconde.** Le vestiaire equipe AU
 *   TOUCHER — chaque objet possede touche part au serveur, sans temporisation
 *   — et le panneau de choix change de danse d'un toucher. Quelqu'un qui
 *   passe ses couleurs en revue a quatre touches par seconde tient pres de six
 *   secondes avant la moindre attente, un equipement par seconde jamais.
 *   Au pire, une boucle coute huit requetes par seconde, soit moins que les
 *   douze qu'un seul equipement coutait avant la suppression des relectures.
 * - **Achat : rafale 5, puis 1 par seconde.** Un achat se confirme par un
 *   second toucher (essai, puis achat) et vide la bourse : personne n'en
 *   enchaine cinq en une seconde.
 *
 * Les deux routes ont chacune leur seau : acheter puis equiper aussitot est
 * le geste le plus naturel de la boutique.
 */
export const INVENTORY_RATE_LIMITS = Object.freeze({
  loadout: Object.freeze({ capacity: 12, refillPerSecond: 2 }),
  buy: Object.freeze({ capacity: 5, refillPerSecond: 1 }),
} satisfies Record<string, TokenBucketOptions>);

export type InventoryRoute = keyof typeof INVENTORY_RATE_LIMITS;

export class InventoryRateLimit {
  private readonly routes: Readonly<Record<InventoryRoute, KeyedTokenBuckets>> = {
    loadout: new KeyedTokenBuckets(INVENTORY_RATE_LIMITS.loadout),
    buy: new KeyedTokenBuckets(INVENTORY_RATE_LIMITS.buy),
  };

  /** Consomme un jeton du joueur sur cette route ; `false` : a refuser en 429. */
  allow(route: InventoryRoute, playerId: string, atMs: number): boolean {
    return this.routes[route].tryConsume(playerId, atMs);
  }
}
