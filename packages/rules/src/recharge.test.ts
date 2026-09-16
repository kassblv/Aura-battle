import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { BALANCE } from './balance.js';
import { createRng } from './rng.js';
import {
  evaluateRecharge,
  generateOrbSequence,
  orbSequenceLength,
  type Orb,
  type RechargeTap,
} from './recharge.js';

/** Sequence de test : que des orbes normales, faciles a compter. */
const normalSequence = (count: number): Orb[] =>
  Array.from({ length: count }, (_, index) => ({
    index,
    x: 0.5,
    y: 0.5,
    kind: 'normal' as const,
    points: BALANCE.recharge.normalOrb.points,
    lifetimeMs: BALANCE.recharge.normalOrb.lifetimeMs,
  }));

/** Tape les `count` premieres orbes, une toutes les 200 ms. */
const tapFirst = (count: number, stepMs = 200): RechargeTap[] =>
  Array.from({ length: count }, (_, i) => ({ atMs: (i + 1) * stepMs, orbIndex: i }));

describe('generateOrbSequence (§4)', () => {
  it('genere assez d orbes pour la pire recharge possible', () => {
    expect(generateOrbSequence(createRng('g'))).toHaveLength(orbSequenceLength());
  });

  it('place chaque orbe dans le carre unite', () => {
    for (const o of generateOrbSequence(createRng('g'))) {
      expect(o.x).toBeGreaterThanOrEqual(0);
      expect(o.x).toBeLessThanOrEqual(1);
      expect(o.y).toBeGreaterThanOrEqual(0);
      expect(o.y).toBeLessThanOrEqual(1);
    }
  });

  it('numerote les orbes dans l ordre', () => {
    generateOrbSequence(createRng('g')).forEach((o, i) => {
      expect(o.index).toBe(i);
    });
  });

  it('donne a chaque orbe les points et la duree de vie de son type', () => {
    for (const o of generateOrbSequence(createRng('g'))) {
      const reference =
        o.kind === 'golden' ? BALANCE.recharge.goldenOrb : BALANCE.recharge.normalOrb;
      expect(o.points).toBe(reference.points);
      expect(o.lifetimeMs).toBe(reference.lifetimeMs);
    }
  });

  it('produit environ 13 % d orbes dorees', () => {
    const rng = createRng('echantillon-dore');
    let golden = 0;
    let total = 0;
    for (let i = 0; i < 200; i += 1) {
      for (const o of generateOrbSequence(rng)) {
        total += 1;
        if (o.kind === 'golden') golden += 1;
      }
    }
    expect(golden / total).toBeCloseTo(0.13, 2);
  });

  it('redonne exactement la meme sequence pour une meme graine', () => {
    expect(generateOrbSequence(createRng('manche-1'))).toEqual(
      generateOrbSequence(createRng('manche-1')),
    );
  });

  it('donne des sequences differentes pour des graines differentes', () => {
    expect(generateOrbSequence(createRng('manche-1'))).not.toEqual(
      generateOrbSequence(createRng('manche-2')),
    );
  });
});

describe('evaluateRecharge — comptage des points', () => {
  it('ne donne rien sans aucun tap', () => {
    const result = evaluateRecharge([], normalSequence(50));
    expect(result.points).toBe(0);
    expect(result.hits).toBe(0);
  });

  it('compte un point par orbe normale touchee', () => {
    const result = evaluateRecharge(tapFirst(3), normalSequence(50));
    expect(result.hits).toBe(3);
    expect(result.points).toBe(3);
  });

  it('compte trois points pour une orbe doree', () => {
    const sequence = normalSequence(50);
    sequence[0] = { ...sequence[0]!, kind: 'golden', points: 3, lifetimeMs: 950 };
    const result = evaluateRecharge([{ atMs: 100, orbIndex: 0 }], sequence);
    expect(result.points).toBe(3);
  });

  it('remplace une orbe touchee par la suivante de la sequence', () => {
    // Les 3 premieres orbes sont visibles ; toucher l orbe 0 fait entrer l orbe 3.
    const result = evaluateRecharge(
      [
        { atMs: 100, orbIndex: 0 },
        { atMs: 200, orbIndex: 3 },
      ],
      normalSequence(50),
    );
    expect(result.hits).toBe(2);
  });

  it('ne rend visible que trois orbes a la fois', () => {
    // L orbe 3 n est pas encore entree en jeu a t = 100.
    const result = evaluateRecharge([{ atMs: 100, orbIndex: 3 }], normalSequence(50));
    expect(result.hits).toBe(0);
    expect(result.rejectedTaps).toBe(1);
  });
});

describe('evaluateRecharge — combo (§4)', () => {
  it('suit la plus longue serie', () => {
    const result = evaluateRecharge(tapFirst(5), normalSequence(50));
    expect(result.bestCombo).toBe(5);
  });

  it('bonifie chaque orbe a partir de la dixieme d affilee', () => {
    const result = evaluateRecharge(tapFirst(10, 100), normalSequence(50));
    // 10 orbes a 1 point, plus 1 point de bonus sur la dixieme
    expect(result.points).toBe(11);
    expect(result.bestCombo).toBe(10);
  });

  it('continue a bonifier au-dela du seuil', () => {
    const result = evaluateRecharge(tapFirst(12, 100), normalSequence(50));
    expect(result.points).toBe(12 + 3);
  });

  it('remet le combo a zero sur un tap dans le vide', () => {
    const taps: RechargeTap[] = [
      ...tapFirst(4, 100),
      { atMs: 500, orbIndex: null },
      { atMs: 600, orbIndex: 4 },
    ];
    const result = evaluateRecharge(taps, normalSequence(50));
    expect(result.bestCombo).toBe(4);
    expect(result.emptyTaps).toBe(1);
  });

  it('remet le combo a zero quand une orbe expire', () => {
    const taps: RechargeTap[] = [
      { atMs: 100, orbIndex: 0 },
      { atMs: 200, orbIndex: 1 },
      // l orbe 2 est entree a t = 0 et vit 1600 ms : elle expire a t = 1600
      { atMs: 2_000, orbIndex: 3 },
    ];
    const result = evaluateRecharge(taps, normalSequence(50));
    expect(result.expiredOrbs).toBeGreaterThanOrEqual(1);
    expect(result.bestCombo).toBe(2);
  });
});

describe('evaluateRecharge — anti-triche (§4)', () => {
  it('ignore et signale un tap sur une orbe deja morte', () => {
    const result = evaluateRecharge(
      [
        { atMs: 100, orbIndex: 0 },
        { atMs: 200, orbIndex: 0 },
      ],
      normalSequence(50),
    );
    expect(result.hits).toBe(1);
    expect(result.rejectedTaps).toBe(1);
  });

  it('ne casse pas le combo avec un tap rejete', () => {
    const result = evaluateRecharge(
      [
        { atMs: 100, orbIndex: 0 },
        { atMs: 150, orbIndex: 0 },
        { atMs: 200, orbIndex: 1 },
      ],
      normalSequence(50),
    );
    expect(result.bestCombo).toBe(2);
  });

  it('plafonne a 12 taps comptabilises par seconde', () => {
    // 20 taps dans la meme seconde : 12 comptes, 8 rejetes
    const taps: RechargeTap[] = Array.from({ length: 20 }, (_, i) => ({
      atMs: 10 + i * 40,
      orbIndex: i,
    }));
    const result = evaluateRecharge(taps, normalSequence(50));
    expect(result.hits).toBe(12);
    expect(result.rejectedTaps).toBe(8);
  });

  it('laisse passer 12 taps par seconde sur toute la duree', () => {
    const taps: RechargeTap[] = Array.from({ length: 60 }, (_, i) => ({
      atMs: Math.floor(i / 12) * 1_000 + (i % 12) * 80,
      orbIndex: i,
    }));
    const result = evaluateRecharge(taps, normalSequence(200));
    expect(result.rejectedTaps).toBe(0);
  });

  it('ignore un tap avant le debut ou apres la fin de la recharge', () => {
    const result = evaluateRecharge(
      [
        { atMs: -10, orbIndex: 0 },
        { atMs: BALANCE.recharge.durationMs + 1, orbIndex: 1 },
      ],
      normalSequence(50),
    );
    expect(result.hits).toBe(0);
    expect(result.rejectedTaps).toBe(2);
  });

  it('remet les taps dans l ordre chronologique avant de juger', () => {
    const desordre: RechargeTap[] = [
      { atMs: 300, orbIndex: 3 },
      { atMs: 100, orbIndex: 0 },
      { atMs: 200, orbIndex: 1 },
    ];
    const result = evaluateRecharge(desordre, normalSequence(50));
    expect(result.hits).toBe(3);
    expect(result.rejectedTaps).toBe(0);
  });
});

describe('evaluateRecharge — sequence epuisee', () => {
  it('laisse les emplacements vides sans planter quand il n y a plus d orbes', () => {
    const result = evaluateRecharge(tapFirst(3, 100), normalSequence(3));
    expect(result.hits).toBe(3);
    expect(result.points).toBe(3);
  });

  it('rejette les taps suivants une fois la sequence epuisee', () => {
    const taps: RechargeTap[] = [...tapFirst(3, 100), { atMs: 400, orbIndex: 3 }];
    const result = evaluateRecharge(taps, normalSequence(3));
    expect(result.hits).toBe(3);
    expect(result.rejectedTaps).toBe(1);
  });

  it('n expire pas indefiniment quand tous les emplacements sont vides', () => {
    const result = evaluateRecharge([], normalSequence(2));
    expect(result.expiredOrbs).toBe(2);
  });
});

describe('evaluateRecharge — gains (§4)', () => {
  it('convertit 1 point en 1 % de boost', () => {
    expect(evaluateRecharge(tapFirst(5), normalSequence(50)).boostPercent).toBe(5);
  });

  it('plafonne le boost a 25 %', () => {
    const result = evaluateRecharge(tapFirst(40, 100), normalSequence(200));
    expect(result.boostPercent).toBe(25);
  });

  it('convertit 1 point en 2,5 d Ultime', () => {
    expect(evaluateRecharge(tapFirst(4), normalSequence(50)).ultimateGain).toBe(10);
  });

  it('plafonne l Ultime a 40 par recharge', () => {
    const result = evaluateRecharge(tapFirst(40, 100), normalSequence(200));
    expect(result.ultimateGain).toBe(40);
  });

  it('donne 1 energie tous les 8 points', () => {
    expect(evaluateRecharge(tapFirst(7), normalSequence(50)).energyGain).toBe(0);
    expect(evaluateRecharge(tapFirst(8), normalSequence(50)).energyGain).toBe(1);
  });

  it('plafonne l energie a 2 par manche', () => {
    const result = evaluateRecharge(tapFirst(40, 100), normalSequence(200));
    expect(result.energyGain).toBe(2);
  });
});

describe('evaluateRecharge — invariants', () => {
  it('ne rend jamais de valeur negative, ni de gain hors bornes', () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            atMs: fc.integer({ min: -500, max: 7_000 }),
            orbIndex: fc.option(fc.integer({ min: 0, max: 40 }), { nil: null }),
          }),
          { maxLength: 120 },
        ),
        (taps) => {
          const result = evaluateRecharge(taps, normalSequence(200));
          expect(result.points).toBeGreaterThanOrEqual(0);
          expect(result.boostPercent).toBeGreaterThanOrEqual(0);
          expect(result.boostPercent).toBeLessThanOrEqual(BALANCE.recharge.boostPercentMax);
          expect(result.ultimateGain).toBeGreaterThanOrEqual(0);
          expect(result.ultimateGain).toBeLessThanOrEqual(BALANCE.recharge.ultimateMaxPerRecharge);
          expect(result.energyGain).toBeGreaterThanOrEqual(0);
          expect(result.energyGain).toBeLessThanOrEqual(BALANCE.recharge.energyMaxPerRound);
        },
      ),
    );
  });

  it('rend le meme resultat pour les memes taps (determinisme)', () => {
    const taps = tapFirst(9, 150);
    expect(evaluateRecharge(taps, normalSequence(50))).toEqual(
      evaluateRecharge(taps, normalSequence(50)),
    );
  });
});
