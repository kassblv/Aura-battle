import { describe, expect, it } from 'vitest';
import type { SeasonGrant } from '../domain/claim.js';
import { SeasonConflictError, type SeasonRepository } from '../domain/ports.js';
import { SeasonError, SeasonService } from './season.js';

/**
 * La course de « Tout recuperer » : un autre onglet reclame un palier entre
 * la lecture et l'ecriture. La base refuse tout le lot ; le service relit et
 * reprend ce qui reste — une fois, pas en boucle.
 */

const SEASON = { id: 's_1', number: 1, endsAt: new Date('2026-10-27T00:00:00Z') };

function build(conflicts: number) {
  const claimed: { tier: number; track: 'free' | 'premium' }[] = [];
  const writes: (readonly SeasonGrant[])[] = [];
  let remaining = conflicts;
  const seasons: SeasonRepository = {
    current: () => Promise.resolve(SEASON),
    progress: () => Promise.resolve({ xp: 300, premium: false, claimed: [...claimed] }),
    grant: (_playerId, _seasonId, grants) => {
      writes.push(grants);
      if (remaining > 0) {
        remaining -= 1;
        // L'autre onglet est passe : le palier 1 est pris, le lot entier tombe.
        claimed.push({ tier: 1, track: 'free' });
        return Promise.reject(new SeasonConflictError('ALREADY_CLAIMED'));
      }
      claimed.push(...grants.map((g) => ({ tier: g.tier, track: g.track })));
      return Promise.resolve();
    },
    buyPremium: () => Promise.resolve(),
  };
  const service = new SeasonService({
    seasons,
    inventory: {
      catalogue: () => Promise.resolve([]),
      read: () => Promise.resolve({ wallet: { soft: 0, hard: 0 }, owned: [], loadout: null }),
    },
    clock: { now: () => new Date('2026-09-25T12:00:00Z') },
  });
  return { service, writes, claimed };
}

describe('SeasonService.claimAll', () => {
  it('relit et reprend ce qui reste apres une reclamation concurrente', async () => {
    const { service, writes } = build(1);
    const state = await service.claimAll('p1');
    expect(writes.map((lot) => lot.map((g) => g.tier))).toEqual([
      [1, 2, 3],
      [2, 3],
    ]);
    expect(state.claimed.map((c) => c.tier).sort()).toEqual([1, 2, 3]);
  });

  it('abandonne au second conflit, en ALREADY_CLAIMED', async () => {
    const { service, writes } = build(2);
    await expect(service.claimAll('p1')).rejects.toEqual(new SeasonError('ALREADY_CLAIMED'));
    expect(writes.length).toBe(2);
  });
});

/*
  La reclamation est ecrite AVANT que le match l'apprenne. Si ce signal
  echoue, le joueur ne doit pas lire une erreur pour une recompense qu'il a
  bien recue — son nouvel essai lirait « deja reclame ».
*/
describe('SeasonService — signal au match apres un cosmetique', () => {
  it('ne fait pas echouer une reclamation deja ecrite', async () => {
    const warnings: string[] = [];
    const service = new SeasonService({
      seasons: {
        current: () => Promise.resolve(SEASON),
        progress: () => Promise.resolve({ xp: 1_000, premium: false, claimed: [] }),
        grant: () => Promise.resolve(),
        buyPremium: () => Promise.resolve(),
      },
      inventory: {
        catalogue: () =>
          Promise.resolve([
            {
              id: 'color.violet',
              kind: 'AURA_COLOR',
              rarity: 'common',
              priceSoft: 80,
              priceHard: 8,
              availableFrom: null,
              availableTo: null,
            },
          ]),
        read: () => Promise.resolve({ wallet: { soft: 0, hard: 0 }, owned: [], loadout: null }),
      },
      clock: { now: () => new Date('2026-09-25T12:00:00Z') },
      changes: { changed: () => Promise.reject(new Error('socket partie')) },
      warn: (message) => warnings.push(message),
    });
    await expect(service.claim('p1', { tier: 10, track: 'free' })).resolves.toBeDefined();
    expect(warnings).toHaveLength(1);
  });
});
