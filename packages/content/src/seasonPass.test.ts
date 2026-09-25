import { describe, expect, it } from 'vitest';
import { AURA_COLORS, AURA_EFFECTS, HAIRSTYLES, OUTFITS } from './cosmetics.js';
import { allAnimationIds } from './catalogue.js';
import { SEASON_PASS, seasonTierFor } from './seasonPass.js';

const KNOWN = new Set<string>([
  ...AURA_EFFECTS.map((i) => i.id),
  ...AURA_COLORS.map((i) => i.id),
  ...HAIRSTYLES.map((i) => i.id),
  ...OUTFITS.map((i) => i.id),
  ...allAnimationIds(),
]);

describe('SEASON_PASS', () => {
  it('a trente paliers numerotes de 1 a 30, chacun avec une recompense gratuite', () => {
    expect(SEASON_PASS.tiers).toHaveLength(30);
    SEASON_PASS.tiers.forEach((tier, i) => {
      expect(tier.tier).toBe(i + 1);
      expect(tier.free).toBeDefined();
    });
  });

  // Une recompense qui designe un objet inconnu serait une recompense vide.
  it('ne recompense qu avec des objets du catalogue', () => {
    for (const tier of SEASON_PASS.tiers) {
      for (const reward of [tier.free, tier.premium]) {
        if (reward?.kind === 'item') expect(KNOWN.has(reward.itemId)).toBe(true);
        if (reward?.kind === 'coins' || reward?.kind === 'tokens') {
          expect(Number.isInteger(reward.amount) && reward.amount > 0).toBe(true);
        }
      }
    }
  });

  // La promesse du spec : la piste premium rend 200 jetons sur la saison.
  it('rend 200 jetons sur la piste premium, pour 500 payes', () => {
    const back = SEASON_PASS.tiers
      .map((t) => (t.premium?.kind === 'tokens' ? t.premium.amount : 0))
      .reduce((a, b) => a + b, 0);
    expect(SEASON_PASS.premiumPrice).toBe(500);
    expect(back).toBe(200);
  });

  it('n offre jamais deux fois le meme objet', () => {
    const items = SEASON_PASS.tiers.flatMap((t) =>
      [t.free, t.premium].flatMap((r) => (r?.kind === 'item' ? [r.itemId] : [])),
    );
    expect(new Set(items).size).toBe(items.length);
  });
});

describe('seasonTierFor', () => {
  it('rend le dernier palier atteint, 0 au depart, 30 au plafond', () => {
    expect(seasonTierFor(0)).toBe(0);
    expect(seasonTierFor(99)).toBe(0);
    expect(seasonTierFor(100)).toBe(1);
    expect(seasonTierFor(2_950)).toBe(29);
    expect(seasonTierFor(1_000_000)).toBe(30);
    expect(seasonTierFor(-5)).toBe(0);
  });
});
