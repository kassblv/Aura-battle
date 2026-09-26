import { describe, expect, it } from 'vitest';
import { INVENTORY_RATE_LIMITS, InventoryRateLimit } from './inventory-rate-limit.js';

/** Combien d'appels passent, a intervalle regulier, sur une duree donnee. */
function accepted(
  limit: InventoryRateLimit,
  route: 'buy' | 'loadout' | 'read',
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

  /*
    La lecture. Le client relit l'inventaire a l'ouverture (et a chaque
    renouvellement du jeton), apres chaque match qui rapporte des pieces, et
    apres chaque defi reclame. Le pire geste legitime : reclamer tous les defis
    du jour d'affilee en revenant d'un match — une poignee de lectures en une
    seconde.
  */
  it('laisse passer l ouverture, un match et tous les defis reclames d affilee', () => {
    const limit = new InventoryRateLimit();
    // Ouverture, fin de match, puis huit reclamations au toucher, en 1 s.
    for (let i = 0; i < 10; i++) expect(limit.allow('read', 'p-1', i * 100)).toBe(true);
  });

  it('ne refuse jamais une lecture par seconde', () => {
    expect(accepted(new InventoryRateLimit(), 'read', 1_000, 60_000)).toBe(60);
  });

  it('coupe une boucle de lectures', () => {
    const limit = new InventoryRateLimit();
    expect(accepted(limit, 'read', 1, 1_000)).toBeLessThanOrEqual(
      INVENTORY_RATE_LIMITS.read.capacity + INVENTORY_RATE_LIMITS.read.refillPerSecond,
    );
  });

  it('compte la lecture a part des ecritures', () => {
    const limit = new InventoryRateLimit();
    while (limit.allow('read', 'p-1', 0));
    expect(limit.allow('loadout', 'p-1', 0)).toBe(true);
    expect(limit.allow('buy', 'p-1', 0)).toBe(true);
  });
});
