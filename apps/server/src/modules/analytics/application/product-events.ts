import type { ProductEvent } from '@aura/protocol';
import type { Clock, ProductEventStore } from '../domain/ports.js';

/**
 * Evenements produit envoyes par le client (`POST /events`, protocole 2.5.0).
 *
 * Le client ne dit que QUOI et POUR QUEL MATCH ; le serveur sait QUI (le
 * jeton) et QUAND (son horloge). Rien de ce qu'il declare d'autre n'est cru.
 */
export class ProductEventsService {
  private readonly store: ProductEventStore;
  private readonly clock: Clock;

  constructor(deps: { store: ProductEventStore; clock: Clock }) {
    this.store = deps.store;
    this.clock = deps.clock;
  }

  /**
   * Inscrit l'evenement si le joueur siegeait a ce match ; sans effet sinon.
   *
   * Ne rend rien : qu'une ligne ait ete creee ou non ne regarde pas
   * l'appelant, et la reponse ne doit rien apprendre a qui sonde des
   * identifiants de match.
   */
  async report(playerId: string, event: ProductEvent): Promise<void> {
    await this.store.recordIfSeated({
      playerId,
      matchId: event.matchId,
      kind: event.kind,
      atMs: this.clock.now().getTime(),
    });
  }
}
