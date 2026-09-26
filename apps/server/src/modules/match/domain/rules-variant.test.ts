import { serializeServerMessage } from '@aura/protocol';
import { RULE_VARIANTS, variantForWeek, weekIndexOf } from '@aura/rules';
import { describe, expect, it } from 'vitest';
import { isForcibleVariant, rulesVariantFor, weekEventAt, weekStartMs } from './rules-variant.js';

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

/*
  Forcage depuis le panneau (ADR 0018) : la variante forcee de la semaine
  l'emporte sur la rotation, en partie rapide seulement.
*/
describe('rulesVariantFor — semaine forcee depuis le panneau', () => {
  const forced = RULE_VARIANTS[1]!.id;

  it('prend la variante forcee plutot que la rotation', () => {
    expect(rulesVariantFor('CASUAL', VARIANT_WEEK_MS, forced)).toBe(forced);
    expect(rulesVariantFor('CASUAL', NORMAL_WEEK_MS, forced)).toBe(forced);
  });

  it('peut forcer une semaine normale au milieu de la rotation', () => {
    expect(rulesVariantFor('CASUAL', VARIANT_WEEK_MS, 'normal')).toBe('normal');
  });

  it('sans forcage, la rotation', () => {
    expect(rulesVariantFor('CASUAL', VARIANT_WEEK_MS, null)).toBe(RULE_VARIANTS[0]!.id);
  });

  it.each(['RANKED', 'INVITE', 'SOLO'] as const)('%s ignore le forcage', (mode) => {
    expect(rulesVariantFor(mode, VARIANT_WEEK_MS, forced)).toBe('normal');
  });

  it('ignore un forcage qui ne nomme plus aucune variante', () => {
    expect(rulesVariantFor('CASUAL', NORMAL_WEEK_MS, 'retiree')).toBe('normal');
    expect(rulesVariantFor('CASUAL', VARIANT_WEEK_MS, 'retiree')).toBe(RULE_VARIANTS[0]!.id);
  });
});

describe('isForcibleVariant', () => {
  it('accepte normal et chaque variante declaree, rien d autre', () => {
    expect(isForcibleVariant('normal')).toBe(true);
    for (const variant of RULE_VARIANTS) expect(isForcibleVariant(variant.id)).toBe(true);
    expect(isForcibleVariant('inconnue')).toBe(false);
    expect(isForcibleVariant('')).toBe(false);
  });
});

describe('semaines', () => {
  it('weekStartMs est le lundi 00:00 UTC de weekIndexOf', () => {
    for (const week of [0, 1, 2, 2_000, 2_960]) {
      const start = weekStartMs(week);
      expect(new Date(start).getUTCDay()).toBe(1);
      expect(new Date(start).getUTCHours()).toBe(0);
      expect(weekIndexOf(start)).toBe(week);
      expect(weekIndexOf(start - 1)).toBe(week - 1);
    }
  });

  it('weekEventAt : la semaine, sa variante et sa fin', () => {
    const at = Date.UTC(2026, 8, 26, 15);
    const week = weekIndexOf(at);
    expect(weekEventAt(at, null)).toEqual({
      week,
      variant: variantForWeek(week),
      endsAt: new Date(weekStartMs(week + 1)).toISOString(),
    });
    expect(weekEventAt(at, 'normal').variant).toBe('normal');
    expect(weekEventAt(at, 'retiree').variant).toBe(variantForWeek(week));
  });
});

/*
  Les variantes sont declarees dans `@aura/rules`, le format de leur identifiant
  dans `@aura/protocol`. Rien ne relie les deux au typecheck : une variante au
  nom trop long ou accentue ferait echouer l'EMISSION de `match:found`, et la
  partie rapide ne s'ouvrirait plus de toute la semaine.
*/
describe('chaque variante s annonce dans match:found', () => {
  it.each(RULE_VARIANTS.map((variant) => variant.id))('%s', (id) => {
    const found = serializeServerMessage('match:found', {
      matchId: 'm_01',
      seat: 'a',
      opponent: { displayName: 'Nova', league: 'bronze', cosmetics: {} },
      protocolVersion: '2.4.1',
      rulesVersion: '1.0.0',
      rulesVariant: id,
      contentVersion: '1',
      ghost: false,
    });
    expect(found.success).toBe(true);
  });
});
