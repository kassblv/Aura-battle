import { describe, expect, it } from 'vitest';
import { AURA_COLORS, isExclusive, OUTFITS } from './cosmetics.js';
import { featuredForDay } from './featured.js';
import { SEASON_PASS } from './seasonPass.js';

/*
  Un cosmetique exclusif de saison ne s'obtient QUE par le passe. Il porte un
  prix de 0 (il ne se vend pas) : partout ou « 0 » voulait dire « offert a
  tous », il faut d'abord regarder `exclusive`.
*/
describe('cosmetiques exclusifs de saison', () => {
  const exclusives = [...AURA_COLORS, ...OUTFITS].filter((item) => item.exclusive !== undefined);

  it('existent, et se reconnaissent', () => {
    expect(exclusives.map((item) => item.id)).toEqual(['color.aurore', 'outfit.aurore']);
    for (const item of exclusives) expect(isExclusive(item.id)).toBe(true);
    expect(isExclusive('color.violet')).toBe(false);
  });

  it('ne passent jamais en vitrine', () => {
    for (let day = 0; day < 30; day += 1) {
      for (const id of featuredForDay(day)) expect(isExclusive(id)).toBe(false);
    }
  });

  // Le grand prix du passe : le dernier palier premium.
  it('sont des recompenses de la piste premium, la tenue au dernier palier', () => {
    const premium = SEASON_PASS.tiers.flatMap((t) =>
      t.premium.kind === 'item' ? [[t.tier, t.premium.itemId] as const] : [],
    );
    expect(premium).toContainEqual([30, 'outfit.aurore']);
    expect(premium.map(([, id]) => id)).toContain('color.aurore');
  });
});
