import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { createRng, deriveSeed } from './rng.js';

const drain = (seed: string, count = 20): number[] => {
  const rng = createRng(seed);
  return Array.from({ length: count }, () => rng.nextFloat());
};

describe('createRng — determinisme', () => {
  it('rejoue exactement la meme suite pour une meme graine', () => {
    expect(drain('manche-1')).toEqual(drain('manche-1'));
  });

  it('produit des suites differentes pour des graines differentes', () => {
    expect(drain('manche-1')).not.toEqual(drain('manche-2'));
  });

  it('rejoue la meme suite quelle que soit la graine (propriete)', () => {
    fc.assert(
      fc.property(fc.string(), (seed) => {
        expect(drain(seed, 8)).toEqual(drain(seed, 8));
      }),
    );
  });

  it('ne se remet pas a zero en cours de route', () => {
    const rng = createRng('graine');
    const premier = rng.nextFloat();
    const deuxieme = rng.nextFloat();
    expect(premier).not.toBe(deuxieme);
  });
});

describe('nextFloat', () => {
  it('reste dans [0, 1[', () => {
    fc.assert(
      fc.property(fc.string(), (seed) => {
        const rng = createRng(seed);
        for (let i = 0; i < 50; i += 1) {
          const value = rng.nextFloat();
          expect(value).toBeGreaterThanOrEqual(0);
          expect(value).toBeLessThan(1);
        }
      }),
    );
  });
});

describe('nextInt', () => {
  it('reste dans les bornes, incluses', () => {
    fc.assert(
      fc.property(fc.string(), fc.integer({ min: -50, max: 50 }), (seed, min) => {
        const max = min + 7;
        const rng = createRng(seed);
        for (let i = 0; i < 30; i += 1) {
          const value = rng.nextInt(min, max);
          expect(value).toBeGreaterThanOrEqual(min);
          expect(value).toBeLessThanOrEqual(max);
          expect(Number.isInteger(value)).toBe(true);
        }
      }),
    );
  });

  it('renvoie toujours la borne quand l intervalle est reduit a un point', () => {
    const rng = createRng('graine');
    expect(rng.nextInt(4, 4)).toBe(4);
  });

  it('couvre bien les deux bornes sur un grand nombre de tirages', () => {
    const rng = createRng('couverture');
    const vus = new Set<number>();
    for (let i = 0; i < 400; i += 1) {
      vus.add(rng.nextInt(0, 2));
    }
    expect([...vus].sort()).toEqual([0, 1, 2]);
  });

  it('refuse un intervalle inverse', () => {
    const rng = createRng('graine');
    expect(() => rng.nextInt(5, 2)).toThrow(RangeError);
  });
});

describe('pick', () => {
  it('renvoie un element de la liste', () => {
    const rng = createRng('graine');
    const items = ['calme', 'hype', 'provoc'] as const;
    for (let i = 0; i < 20; i += 1) {
      expect(items).toContain(rng.pick(items));
    }
  });

  it('choisit le meme element pour une meme graine', () => {
    const items = ['a', 'b', 'c', 'd'];
    expect(createRng('g').pick(items)).toBe(createRng('g').pick(items));
  });

  it('refuse une liste vide', () => {
    expect(() => createRng('graine').pick([])).toThrow(RangeError);
  });
});

describe('chance', () => {
  it('est toujours faux a 0 et toujours vrai a 1', () => {
    const rng = createRng('graine');
    for (let i = 0; i < 50; i += 1) {
      expect(rng.chance(0)).toBe(false);
      expect(rng.chance(1)).toBe(true);
    }
  });

  it('approche la probabilite demandee sur un grand echantillon', () => {
    const rng = createRng('echantillon');
    let succes = 0;
    const tirages = 20_000;
    for (let i = 0; i < tirages; i += 1) {
      if (rng.chance(0.13)) succes += 1;
    }
    expect(succes / tirages).toBeCloseTo(0.13, 2);
  });
});

describe('deriveSeed', () => {
  it('derive une graine stable', () => {
    expect(deriveSeed('match-7', 'round', 2)).toBe(deriveSeed('match-7', 'round', 2));
  });

  it('derive des graines differentes selon les composants', () => {
    expect(deriveSeed('match-7', 'round', 1)).not.toBe(deriveSeed('match-7', 'round', 2));
    expect(deriveSeed('match-7', 'orbs', 1)).not.toBe(deriveSeed('match-7', 'gauge', 1));
  });

  it('donne deux flux independants a partir d une meme graine de match', () => {
    const orbes = drain(deriveSeed('match-7', 'orbs', 1), 10);
    const jauge = drain(deriveSeed('match-7', 'gauge', 1), 10);
    expect(orbes).not.toEqual(jauge);
  });
});
