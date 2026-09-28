import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { BALANCE } from './balance.js';
import { createRng } from './rng.js';
import { cursorPosition, evaluateTiming, generateGaugeParams } from './timing.js';

const params = (center: number, periodMs = 1_600) => ({
  periodMs,
  center,
  zoneWidth: BALANCE.timing.zoneWidth,
  perfectWidth: BALANCE.timing.perfectWidth,
});

describe('cursorPosition — onde triangulaire (§5)', () => {
  it('part de 0 au debut de la periode', () => {
    expect(cursorPosition(0, 1_600)).toBe(0);
  });

  it('atteint 1 a la moitie de la periode', () => {
    expect(cursorPosition(800, 1_600)).toBeCloseTo(1, 10);
  });

  it('revient a 0 a la fin de la periode', () => {
    expect(cursorPosition(1_600, 1_600)).toBeCloseTo(0, 10);
  });

  it('monte sur la premiere moitie et descend sur la seconde', () => {
    expect(cursorPosition(400, 1_600)).toBeCloseTo(0.5, 10);
    expect(cursorPosition(1_200, 1_600)).toBeCloseTo(0.5, 10);
  });

  it('se repete d une periode a l autre', () => {
    expect(cursorPosition(300, 1_600)).toBeCloseTo(cursorPosition(300 + 1_600, 1_600), 10);
  });

  it('reste dans [0, 1] a tout instant (propriete)', () => {
    fc.assert(
      fc.property(
        fc.double({ min: 0, max: 60_000, noNaN: true }),
        fc.integer({ min: 1_500, max: 1_900 }),
        (elapsedMs, periodMs) => {
          const position = cursorPosition(elapsedMs, periodMs);
          expect(position).toBeGreaterThanOrEqual(0);
          expect(position).toBeLessThanOrEqual(1);
        },
      ),
    );
  });
});

describe('evaluateTiming — qualite (§5)', () => {
  it('donne Parfait pile au centre', () => {
    const result = evaluateTiming(800, params(1));
    expect(result.quality).toBe('perfect');
    expect(result.delta).toBeCloseTo(0, 10);
    expect(result.multiplier).toBe(1.5);
  });

  it('donne Parfait au bord de la zone parfaite', () => {
    // centre 0,5 atteint a t = 400 ; on vise un ecart de perfectWidth / 2 = 0,04
    const center = 0.5;
    const tapAt = (0.5 + 0.04) * 0.5 * 1_600;
    const result = evaluateTiming(tapAt, params(center));
    expect(result.delta).toBeCloseTo(0.04, 10);
    expect(result.quality).toBe('perfect');
  });

  it('donne Bon juste au-dela de la zone parfaite', () => {
    const center = 0.5;
    const tapAt = (0.5 + 0.05) * 0.5 * 1_600;
    const result = evaluateTiming(tapAt, params(center));
    expect(result.quality).toBe('good');
    expect(result.multiplier).toBe(1.15);
  });

  it('donne Bon au bord de la zone', () => {
    const center = 0.5;
    const tapAt = (0.5 + 0.11) * 0.5 * 1_600;
    const result = evaluateTiming(tapAt, params(center));
    expect(result.delta).toBeCloseTo(0.11, 10);
    expect(result.quality).toBe('good');
  });

  it('donne Rate au-dela de la zone', () => {
    const center = 0.5;
    const tapAt = (0.5 + 0.2) * 0.5 * 1_600;
    const result = evaluateTiming(tapAt, params(center));
    expect(result.quality).toBe('miss');
    expect(result.multiplier).toBe(0.6);
  });
});

describe('evaluateTiming — absence de tap (§5)', () => {
  it('compte un Rate quand le joueur ne tape pas', () => {
    const result = evaluateTiming(null, params(0.5));
    expect(result.quality).toBe('miss');
    expect(result.multiplier).toBe(0.6);
  });

  it('donne le pire ecart possible, pour ne jamais gagner un departage', () => {
    expect(evaluateTiming(null, params(0.5)).delta).toBe(1);
  });

  it('compte un Rate quand le tap arrive apres les 6 secondes de charge', () => {
    const result = evaluateTiming(BALANCE.timing.maxChargeMs + 1, params(0.5));
    expect(result.quality).toBe('miss');
    expect(result.delta).toBe(1);
  });

  it('accepte un tap pile a l echeance', () => {
    const result = evaluateTiming(BALANCE.timing.maxChargeMs, params(0.5));
    expect(result.delta).toBeLessThan(1);
  });

  it('refuse un tap a un instant negatif', () => {
    expect(() => evaluateTiming(-1, params(0.5))).toThrow(RangeError);
  });
});

describe('evaluateTiming — invariants', () => {
  it('garde l ecart dans [0, 1] et le multiplicateur parmi les trois valeurs', () => {
    fc.assert(
      fc.property(
        fc.double({ min: 0, max: 6_000, noNaN: true }),
        fc.double({ min: 0.3, max: 0.7, noNaN: true }),
        (tapAtMs, center) => {
          const result = evaluateTiming(tapAtMs, params(center));
          expect(result.delta).toBeGreaterThanOrEqual(0);
          expect(result.delta).toBeLessThanOrEqual(1);
          expect([1.5, 1.15, 0.6]).toContain(result.multiplier);
        },
      ),
    );
  });

  it('ne rend jamais un meilleur multiplicateur pour un plus grand ecart', () => {
    const center = 0.5;
    let precedent = Number.POSITIVE_INFINITY;
    for (let tapAt = 400; tapAt <= 780; tapAt += 10) {
      const { multiplier } = evaluateTiming(tapAt, params(center));
      expect(multiplier).toBeLessThanOrEqual(precedent);
      precedent = multiplier;
    }
  });
});

describe('generateGaugeParams — tirage par graine (§5)', () => {
  it('tire une periode et un centre dans les bornes documentees', () => {
    fc.assert(
      fc.property(fc.string(), (seed) => {
        const generated = generateGaugeParams(createRng(seed));
        expect(generated.periodMs).toBeGreaterThanOrEqual(1_500);
        expect(generated.periodMs).toBeLessThanOrEqual(1_900);
        expect(generated.center).toBeGreaterThanOrEqual(0.3);
        expect(generated.center).toBeLessThanOrEqual(0.7);
      }),
    );
  });

  it('reprend les largeurs fixes de l equilibrage', () => {
    const generated = generateGaugeParams(createRng('g'));
    expect(generated.zoneWidth).toBe(0.22);
    expect(generated.perfectWidth).toBe(0.08);
  });

  it('redonne exactement la meme jauge pour une meme graine', () => {
    expect(generateGaugeParams(createRng('manche-2'))).toEqual(
      generateGaugeParams(createRng('manche-2')),
    );
  });

  it('donne des jauges differentes pour des graines differentes', () => {
    expect(generateGaugeParams(createRng('manche-1'))).not.toEqual(
      generateGaugeParams(createRng('manche-2')),
    );
  });
});
