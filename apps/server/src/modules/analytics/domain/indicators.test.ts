import { describe, expect, it } from 'vitest';
import {
  buildIndicatorReport,
  INDICATOR_IDS,
  INDICATOR_TARGETS,
  MIN_SAMPLE,
  verdictOf,
  type IndicatorReadings,
  type Measure,
} from './indicators.js';

/**
 * Le verdict des indicateurs produit : pur, on donne une mesure, il rend un
 * mot. C'est ce qui permet de verifier les seuils de docs/00 sans base.
 */

const measure = (value: number | null, n = 100): Measure => ({ value, n });

describe('seuils de docs/00-vision.md', () => {
  it('reprend exactement les sept seuils, et le sens de chaque comparaison', () => {
    expect(INDICATOR_IDS).toHaveLength(7);
    expect(
      Object.fromEntries(
        INDICATOR_IDS.map((id) => [
          id,
          [INDICATOR_TARGETS[id].threshold, INDICATOR_TARGETS[id].comparison],
        ]),
      ),
    ).toEqual({
      retentionD1: [0.35, 'gte'],
      retentionD7: [0.12, 'gte'],
      matchesPerActiveDay: [4, 'gte'],
      medianRankedWaitMs: [20_000, 'lte'],
      clipShareRate: [0.03, 'gte'],
      inviteInstallShare: [0.15, 'gte'],
      abandonRate: [0.05, 'lte'],
    });
  });

  it('exige vingt observations avant de trancher', () => {
    expect(MIN_SAMPLE).toBe(20);
  });
});

describe('verdictOf', () => {
  it('dit atteint quand un plancher est depasse ou egale', () => {
    expect(verdictOf(measure(0.4), INDICATOR_TARGETS.retentionD1)).toBe('met');
    expect(verdictOf(measure(0.35), INDICATOR_TARGETS.retentionD1)).toBe('met');
    expect(verdictOf(measure(4), INDICATOR_TARGETS.matchesPerActiveDay)).toBe('met');
  });

  it('dit manque sous un plancher', () => {
    expect(verdictOf(measure(0.3499), INDICATOR_TARGETS.retentionD1)).toBe('missed');
    expect(verdictOf(measure(0.02), INDICATOR_TARGETS.clipShareRate)).toBe('missed');
  });

  it('compare en « au plus » l attente et l abandon : plus bas est mieux', () => {
    expect(verdictOf(measure(20_000), INDICATOR_TARGETS.medianRankedWaitMs)).toBe('met');
    expect(verdictOf(measure(12_000), INDICATOR_TARGETS.medianRankedWaitMs)).toBe('met');
    expect(verdictOf(measure(20_001), INDICATOR_TARGETS.medianRankedWaitMs)).toBe('missed');
    expect(verdictOf(measure(0.05), INDICATOR_TARGETS.abandonRate)).toBe('met');
    expect(verdictOf(measure(0), INDICATOR_TARGETS.abandonRate)).toBe('met');
    expect(verdictOf(measure(0.051), INDICATOR_TARGETS.abandonRate)).toBe('missed');
  });

  it('refuse de trancher sous vingt observations, meme sur une valeur flatteuse', () => {
    expect(verdictOf(measure(1, 19), INDICATOR_TARGETS.retentionD1)).toBe('insufficient');
    expect(verdictOf(measure(0, 0), INDICATOR_TARGETS.abandonRate)).toBe('insufficient');
    expect(verdictOf(measure(1, 20), INDICATOR_TARGETS.retentionD1)).toBe('met');
  });

  it('refuse de trancher sans valeur', () => {
    expect(verdictOf(measure(null, 500), INDICATOR_TARGETS.medianRankedWaitMs)).toBe(
      'insufficient',
    );
  });
});

describe('buildIndicatorReport', () => {
  const readings: IndicatorReadings = {
    indicators: {
      retentionD1: measure(0.5, 40),
      retentionD7: measure(0.1, 40),
      matchesPerActiveDay: measure(6, 12),
      medianRankedWaitMs: measure(9_000, 300),
      clipShareRate: measure(0.04, 200),
      inviteInstallShare: measure(null, 0),
      abandonRate: measure(0.08, 200),
    },
    ghostShare: measure(0.25, 200),
  };

  it('rend une ligne par indicateur, dans l ordre de docs/00, libelle en francais', () => {
    const report = buildIndicatorReport(readings, Date.UTC(2026, 8, 26, 10));
    expect(report.at).toBe('2026-09-26T10:00:00.000Z');
    expect(report.indicators.map((line) => line.id)).toEqual([...INDICATOR_IDS]);
    expect(report.indicators[0]).toEqual({
      id: 'retentionD1',
      label: 'Rétention J1',
      unit: 'ratio',
      value: 0.5,
      n: 40,
      threshold: 0.35,
      comparison: 'gte',
      verdict: 'met',
    });
    expect(report.indicators.map((line) => line.verdict)).toEqual([
      'met',
      'missed',
      'insufficient',
      'met',
      'met',
      'insufficient',
      'missed',
    ]);
  });

  it('joint la part de fantomes, sans verdict : c est un contexte, pas un objectif', () => {
    const report = buildIndicatorReport(readings, 0);
    expect(report.ghostShare).toEqual({ value: 0.25, n: 200 });
  });
});
