import { RULE_VARIANTS, variantForWeek, weekIndexOf } from '@aura/rules';
import { describe, expect, it } from 'vitest';
import { rulesVariantFor } from './rules-variant.js';

const DAY_MS = 86_400_000;

/** Lundi 12 janvier 1970, midi UTC : semaine 1, celle de la premiere variante. */
const VARIANT_WEEK_MS = Date.UTC(1970, 0, 12, 12);
/** Lundi 5 janvier 1970 : semaine 0, normale. */
const NORMAL_WEEK_MS = Date.UTC(1970, 0, 5, 12);

describe('rulesVariantFor — la variante de la semaine, en partie rapide seulement', () => {
  it('prend la variante de la semaine pour une partie rapide', () => {
    expect(rulesVariantFor('CASUAL', VARIANT_WEEK_MS)).toBe(RULE_VARIANTS[0]!.id);
  });

  it('joue normal une semaine sans evenement', () => {
    expect(rulesVariantFor('CASUAL', NORMAL_WEEK_MS)).toBe('normal');
  });

  it.each(['RANKED', 'INVITE', 'SOLO'] as const)('%s joue toujours les regles normales', (mode) => {
    expect(rulesVariantFor(mode, VARIANT_WEEK_MS)).toBe('normal');
  });

  it('suit la rotation de @aura/rules, semaine apres semaine', () => {
    for (let week = 0; week < 20; week += 1) {
      const atMs = NORMAL_WEEK_MS + week * 7 * DAY_MS;
      expect(rulesVariantFor('CASUAL', atMs)).toBe(variantForWeek(weekIndexOf(atMs)));
    }
  });
});
