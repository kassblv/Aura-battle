import { describe, expect, it } from 'vitest';
import { INVENTORY_RATE_LIMITS, InventoryRateLimit } from './inventory-rate-limit.js';

/** Combien d'appels passent, a intervalle regulier, sur une duree donnee. */
function accepted(
  limit: InventoryRateLimit,
  route: 'buy' | 'loadout',
  everyMs: number,
  durationMs: number,
): number {
  let count = 0;
  for (let at = 0; at < durationMs; at += everyMs) {
    if (limit.allow(route, 'p-1', at)) count += 1;
  }
  return count;
}

describe('InventoryRateLimit', () => {
  /*
    Le vestiaire equipe AU TOUCHER : chaque objet possede touche part au
    serveur. Quelqu'un qui passe ses couleurs en revue tape vite, par rafales.
    Quatre touches par seconde pendant cinq secondes, sans une seule reponse
    refusee.
  */
  it('laisse un joueur passer ses objets en revue, vite', () => {
    expect(accepted(new InventoryRateLimit(), 'loadout', 250, 5_000)).toBe(20);
  });

  /* Une danse changee a chaque manche, ou une par seconde au panneau de choix. */
  it('ne refuse jamais un equipement par seconde', () => {
    expect(accepted(new InventoryRateLimit(), 'loadout', 1_000, 60_000)).toBe(60);
  });

  it('coupe une boucle d equipements', () => {
    const limit = new InventoryRateLimit();
    // Mille appels dans la meme seconde : la rafale passe, le reste non.
    expect(accepted(limit, 'loadout', 1, 1_000)).toBeLessThanOrEqual(
      INVENTORY_RATE_LIMITS.loadout.capacity + INVENTORY_RATE_LIMITS.loadout.refillPerSecond,
    );
  });

  it('borne le regime d une boucle au debit de recharge', () => {
    const limit = new InventoryRateLimit();
    const perMinute = accepted(limit, 'loadout', 10, 60_000);
    expect(perMinute).toBeLessThanOrEqual(
      INVENTORY_RATE_LIMITS.loadout.capacity + 60 * INVENTORY_RATE_LIMITS.loadout.refillPerSecond,
    );
  });

  /* Un achat est un geste delibere, confirme par un second toucher. */
  it('laisse passer quelques achats d affilee, puis un par seconde', () => {
    const limit = new InventoryRateLimit();
    for (let i = 0; i < INVENTORY_RATE_LIMITS.buy.capacity; i++) {
      expect(limit.allow('buy', 'p-1', 0)).toBe(true);
    }
    expect(limit.allow('buy', 'p-1', 0)).toBe(false);
    expect(limit.allow('buy', 'p-1', 1_000)).toBe(true);
  });

  it('compte chaque route a part : acheter puis equiper ne se gene pas', () => {
    const limit = new InventoryRateLimit();
    while (limit.allow('buy', 'p-1', 0));
    expect(limit.allow('loadout', 'p-1', 0)).toBe(true);
  });

  /* Par JOUEUR : la boucle d'un compte ne coute rien aux autres. */
  it('compte chaque joueur a part', () => {
    const limit = new InventoryRateLimit();
    while (limit.allow('loadout', 'p-1', 0));
    expect(limit.allow('loadout', 'p-2', 0)).toBe(true);
  });
});
