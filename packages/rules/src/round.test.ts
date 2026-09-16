import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { BALANCE } from './balance.js';
import { choiceCost, isChoiceAffordable, resolveRound, type RoundSeatInput } from './round.js';
import type { TimingResult } from './timing.js';
import type { AmplifierLevel, Choice, Move, Style, Tier } from './types.js';

const timing = (quality: TimingResult['quality'], delta = 0): TimingResult => ({
  quality,
  delta,
  multiplier: BALANCE.timing.qualityMultiplier[quality],
});

const seat = (options: {
  style: Style;
  tier: Tier;
  amplifier?: AmplifierLevel;
  quality?: TimingResult['quality'];
  delta?: number;
  useUltimate?: boolean;
  boostPercent?: number;
  previousMoves?: readonly Move[];
}): RoundSeatInput => ({
  choice: {
    move: { style: options.style, tier: options.tier },
    amplifier: options.amplifier ?? 0,
    useUltimate: options.useUltimate ?? false,
  },
  timing: timing(options.quality ?? 'perfect', options.delta ?? 0),
  boostPercent: options.boostPercent ?? 0,
  previousMoves: options.previousMoves ?? [],
});

describe('choiceCost (§3)', () => {
  it('additionne le cout du palier et celui de l amplificateur', () => {
    expect(
      choiceCost({ move: { style: 'calme', tier: 3 }, amplifier: 2, useUltimate: false }),
    ).toBe(5);
  });

  it('ne coute rien au palier 0 sans amplificateur', () => {
    expect(choiceCost({ move: { style: 'hype', tier: 0 }, amplifier: 0, useUltimate: false })).toBe(
      0,
    );
  });

  it('ne fait rien payer pour l Ultime, qui se paie en jauge', () => {
    const sansUltime: Choice = {
      move: { style: 'hype', tier: 2 },
      amplifier: 1,
      useUltimate: false,
    };
    const avecUltime = { ...sansUltime, useUltimate: true };
    expect(choiceCost(avecUltime)).toBe(choiceCost(sansUltime));
  });

  it('plafonne a 8, le choix le plus cher du jeu', () => {
    expect(
      choiceCost({ move: { style: 'provoc', tier: 4 }, amplifier: 4, useUltimate: false }),
    ).toBe(BALANCE.maxRoundCost);
  });
});

describe('isChoiceAffordable (§3)', () => {
  const choix: Choice = { move: { style: 'calme', tier: 3 }, amplifier: 2, useUltimate: false };

  it('accepte un choix que l energie couvre exactement', () => {
    expect(isChoiceAffordable(choix, 5)).toBe(true);
  });

  it('refuse un choix trop cher d un seul point', () => {
    expect(isChoiceAffordable(choix, 4)).toBe(false);
  });
});

describe('resolveRound — score de base (§7)', () => {
  it('multiplie puissance, amplificateur et timing', () => {
    const result = resolveRound({
      a: seat({ style: 'calme', tier: 2 }),
      b: seat({ style: 'calme', tier: 2 }),
    });
    // 30 x 1,00 x 1,50 = 45
    expect(result.seats.a.score).toBe(45);
  });

  it('applique l amplificateur', () => {
    const result = resolveRound({
      a: seat({ style: 'calme', tier: 2, amplifier: 2 }),
      b: seat({ style: 'calme', tier: 2 }),
    });
    // 30 x 1,50 x 1,50 = 67,5 -> 68
    expect(result.seats.a.score).toBe(68);
  });

  it('applique le boost de recharge', () => {
    const result = resolveRound({
      a: seat({ style: 'calme', tier: 2, boostPercent: 20 }),
      b: seat({ style: 'calme', tier: 2 }),
    });
    // 30 x 1,50 x 1,20 = 54
    expect(result.seats.a.score).toBe(54);
  });

  it('punit un mauvais timing', () => {
    const result = resolveRound({
      a: seat({ style: 'calme', tier: 2, quality: 'miss', delta: 0.4 }),
      b: seat({ style: 'calme', tier: 2 }),
    });
    // 30 x 0,60 = 18
    expect(result.seats.a.score).toBe(18);
  });
});

describe('resolveRound — repetition (§7)', () => {
  it('penalise un mouvement deja joue dans le match', () => {
    const result = resolveRound({
      a: seat({ style: 'calme', tier: 2, previousMoves: [{ style: 'calme', tier: 2 }] }),
      b: seat({ style: 'calme', tier: 2 }),
    });
    // 30 x 1,50 x 0,70 = 31,5 -> 32
    expect(result.seats.a.repeated).toBe(true);
    expect(result.seats.a.score).toBe(32);
  });

  it('ne penalise pas un meme style a un autre palier', () => {
    const result = resolveRound({
      a: seat({ style: 'calme', tier: 2, previousMoves: [{ style: 'calme', tier: 1 }] }),
      b: seat({ style: 'calme', tier: 2 }),
    });
    expect(result.seats.a.repeated).toBe(false);
    expect(result.seats.a.score).toBe(45);
  });

  it('ne penalise pas un meme palier dans un autre style', () => {
    const result = resolveRound({
      a: seat({ style: 'calme', tier: 2, previousMoves: [{ style: 'hype', tier: 2 }] }),
      b: seat({ style: 'calme', tier: 2 }),
    });
    expect(result.seats.a.repeated).toBe(false);
  });

  it('ne regarde que l historique du siege concerne', () => {
    const result = resolveRound({
      a: seat({ style: 'calme', tier: 2 }),
      b: seat({ style: 'calme', tier: 2, previousMoves: [{ style: 'calme', tier: 2 }] }),
    });
    expect(result.seats.a.repeated).toBe(false);
    expect(result.seats.b.repeated).toBe(true);
  });
});

describe('resolveRound — robustesse de l arrondi', () => {
  it('arrondit 31,5 a 32 malgre l erreur flottante du produit', () => {
    // 30 x 1,50 x 0,70 vaut 31,499999999999996 en flottant : sans precaution,
    // le joueur perdrait un point entier de score.
    const result = resolveRound({
      a: seat({ style: 'calme', tier: 2, previousMoves: [{ style: 'calme', tier: 2 }] }),
      b: seat({ style: 'calme', tier: 2 }),
    });
    expect(30 * 1.5 * 0.7).not.toBe(31.5);
    expect(result.seats.a.score).toBe(32);
  });

  it('arrondit toujours vers l entier le plus proche', () => {
    // 11 x 1,15 = 12,65 -> 13
    const result = resolveRound({
      a: seat({ style: 'calme', tier: 0, quality: 'good', delta: 0.05 }),
      b: seat({ style: 'calme', tier: 0, quality: 'good', delta: 0.05 }),
    });
    expect(result.seats.a.score).toBe(13);
  });
});

describe('resolveRound — contres (§2)', () => {
  it('donne x1,35 a celui qui contre et x0,85 a celui qui est contre', () => {
    const result = resolveRound({
      a: seat({ style: 'calme', tier: 2 }),
      b: seat({ style: 'hype', tier: 2 }),
    });
    expect(result.seats.a.countered).toBe(true);
    expect(result.seats.b.wasCountered).toBe(true);
    // 45 x 1,35 = 60,75 -> 61 ; 45 x 0,85 = 38,25 -> 38
    expect(result.seats.a.score).toBe(61);
    expect(result.seats.b.score).toBe(38);
  });

  it('fait tourner le cycle dans les trois sens', () => {
    const cycle: readonly [Style, Style][] = [
      ['calme', 'hype'],
      ['hype', 'provoc'],
      ['provoc', 'calme'],
    ];
    for (const [gagnant, perdant] of cycle) {
      const result = resolveRound({
        a: seat({ style: gagnant, tier: 2 }),
        b: seat({ style: perdant, tier: 2 }),
      });
      expect(result.seats.a.countered).toBe(true);
      expect(result.seats.b.countered).toBe(false);
    }
  });

  it('n applique aucun effet quand les deux styles sont identiques', () => {
    const result = resolveRound({
      a: seat({ style: 'hype', tier: 2 }),
      b: seat({ style: 'hype', tier: 2 }),
    });
    expect(result.seats.a.countered).toBe(false);
    expect(result.seats.a.wasCountered).toBe(false);
    expect(result.seats.a.score).toBe(result.seats.b.score);
  });
});

describe('resolveRound — Ultime (§6)', () => {
  it('multiplie le score par 1,5', () => {
    const result = resolveRound({
      a: seat({ style: 'calme', tier: 2, useUltimate: true }),
      b: seat({ style: 'calme', tier: 2 }),
    });
    // 30 x 1,50 x 1,50 = 67,5 -> 68
    expect(result.seats.a.score).toBe(68);
  });

  it('annule le contre adverse et le signale', () => {
    // b joue calme, qui bat le hype de a : sans Ultime, b contrerait.
    const result = resolveRound({
      a: seat({ style: 'hype', tier: 2, useUltimate: true }),
      b: seat({ style: 'calme', tier: 2 }),
    });
    expect(result.seats.b.counterBlocked).toBe(true);
    expect(result.seats.b.countered).toBe(false);
    expect(result.seats.a.wasCountered).toBe(false);
  });

  it('ne fait pas subir de malus a celui dont le contre est bloque', () => {
    const result = resolveRound({
      a: seat({ style: 'hype', tier: 2, useUltimate: true }),
      b: seat({ style: 'calme', tier: 2 }),
    });
    // b garde son score nu : 45, sans x1,35 ni x0,85
    expect(result.seats.b.score).toBe(45);
  });

  it('laisse l Ultime contrer quand c est lui qui a le bon style', () => {
    const result = resolveRound({
      a: seat({ style: 'calme', tier: 2, useUltimate: true }),
      b: seat({ style: 'hype', tier: 2 }),
    });
    expect(result.seats.a.countered).toBe(true);
    expect(result.seats.b.wasCountered).toBe(true);
  });

  it('ne signale pas de contre bloque quand il n y avait pas de contre', () => {
    const result = resolveRound({
      a: seat({ style: 'calme', tier: 2, useUltimate: true }),
      b: seat({ style: 'calme', tier: 2 }),
    });
    expect(result.seats.b.counterBlocked).toBe(false);
  });
});

describe('resolveRound — vainqueur et departage (§7)', () => {
  it('donne la manche au plus haut score', () => {
    const result = resolveRound({
      a: seat({ style: 'calme', tier: 3 }),
      b: seat({ style: 'calme', tier: 2 }),
    });
    expect(result.winner).toBe('a');
  });

  it('departage a score egal par le plus petit ecart de timing', () => {
    const result = resolveRound({
      a: seat({ style: 'calme', tier: 2, delta: 0.01 }),
      b: seat({ style: 'calme', tier: 2, delta: 0.03 }),
    });
    expect(result.seats.a.score).toBe(result.seats.b.score);
    expect(result.winner).toBe('a');
  });

  it('declare la manche nulle quand tout est egal', () => {
    const result = resolveRound({
      a: seat({ style: 'calme', tier: 2, delta: 0.02 }),
      b: seat({ style: 'calme', tier: 2, delta: 0.02 }),
    });
    expect(result.winner).toBe(null);
  });
});

describe('resolveRound — jauge d Ultime gagnee (§6)', () => {
  it('donne 40 pour un timing parfait', () => {
    const result = resolveRound({
      a: seat({ style: 'calme', tier: 2 }),
      b: seat({ style: 'calme', tier: 2 }),
    });
    expect(result.seats.a.ultimateGain).toBe(40);
  });

  it('donne 35 pour un contre reussi', () => {
    const result = resolveRound({
      a: seat({ style: 'calme', tier: 2, quality: 'good', delta: 0.05 }),
      b: seat({ style: 'hype', tier: 2, quality: 'good', delta: 0.05 }),
    });
    expect(result.seats.a.ultimateGain).toBe(35);
  });

  it('ne recompense pas un contre bloque', () => {
    const result = resolveRound({
      a: seat({ style: 'hype', tier: 2, quality: 'good', delta: 0.05, useUltimate: true }),
      b: seat({ style: 'calme', tier: 2, quality: 'good', delta: 0.05 }),
    });
    expect(result.seats.b.ultimateGain).toBe(BALANCE.ultimate.gainOnRoundLost);
  });

  it('donne 25 pour une manche perdue', () => {
    const result = resolveRound({
      a: seat({ style: 'calme', tier: 4, quality: 'good', delta: 0.05 }),
      b: seat({ style: 'calme', tier: 0, quality: 'good', delta: 0.05 }),
    });
    expect(result.winner).toBe('a');
    expect(result.seats.b.ultimateGain).toBe(25);
  });

  it('cumule parfait et manche perdue', () => {
    const result = resolveRound({
      a: seat({ style: 'calme', tier: 4, quality: 'good', delta: 0.05 }),
      b: seat({ style: 'calme', tier: 0, quality: 'perfect', delta: 0 }),
    });
    expect(result.seats.b.ultimateGain).toBe(40 + 25);
  });

  it('ne donne rien pour une manche nulle sans parfait ni contre', () => {
    const result = resolveRound({
      a: seat({ style: 'calme', tier: 2, quality: 'good', delta: 0.05 }),
      b: seat({ style: 'calme', tier: 2, quality: 'good', delta: 0.05 }),
    });
    expect(result.winner).toBe(null);
    expect(result.seats.a.ultimateGain).toBe(0);
  });
});

describe('resolveRound — energie depensee', () => {
  it('rend le cout du choix de chaque siege', () => {
    const result = resolveRound({
      a: seat({ style: 'calme', tier: 3, amplifier: 2 }),
      b: seat({ style: 'hype', tier: 1, amplifier: 0 }),
    });
    expect(result.seats.a.energySpent).toBe(5);
    expect(result.seats.b.energySpent).toBe(1);
  });
});

describe('resolveRound — invariants', () => {
  const styleArb = fc.constantFrom<Style>('calme', 'hype', 'provoc');
  const tierArb = fc.constantFrom<Tier>(0, 1, 2, 3, 4);
  const amplifierArb = fc.constantFrom<AmplifierLevel>(0, 1, 2, 3, 4);
  const seatArb = fc.record({
    style: styleArb,
    tier: tierArb,
    amplifier: amplifierArb,
    quality: fc.constantFrom<TimingResult['quality']>('perfect', 'good', 'miss'),
    delta: fc.double({ min: 0, max: 1, noNaN: true }),
    useUltimate: fc.boolean(),
    boostPercent: fc.integer({ min: 0, max: 25 }),
  });

  it('ne rend jamais un score inferieur a 1', () => {
    fc.assert(
      fc.property(seatArb, seatArb, (left, right) => {
        const result = resolveRound({ a: seat(left), b: seat(right) });
        expect(result.seats.a.score).toBeGreaterThanOrEqual(1);
        expect(result.seats.b.score).toBeGreaterThanOrEqual(1);
      }),
    );
  });

  it('ne rend jamais deux vainqueurs', () => {
    fc.assert(
      fc.property(seatArb, seatArb, (left, right) => {
        const result = resolveRound({ a: seat(left), b: seat(right) });
        expect([null, 'a', 'b']).toContain(result.winner);
      }),
    );
  });

  it('ne laisse jamais les deux sieges se contrer en meme temps', () => {
    fc.assert(
      fc.property(seatArb, seatArb, (left, right) => {
        const result = resolveRound({ a: seat(left), b: seat(right) });
        expect(result.seats.a.countered && result.seats.b.countered).toBe(false);
      }),
    );
  });

  it('donne toujours la manche au plus haut score', () => {
    fc.assert(
      fc.property(seatArb, seatArb, (left, right) => {
        const result = resolveRound({ a: seat(left), b: seat(right) });
        if (result.seats.a.score > result.seats.b.score) {
          expect(result.winner).toBe('a');
        } else if (result.seats.b.score > result.seats.a.score) {
          expect(result.winner).toBe('b');
        }
      }),
    );
  });

  it('garde la jauge gagnee dans [0, 100]', () => {
    fc.assert(
      fc.property(seatArb, seatArb, (left, right) => {
        const result = resolveRound({ a: seat(left), b: seat(right) });
        for (const outcome of [result.seats.a, result.seats.b]) {
          expect(outcome.ultimateGain).toBeGreaterThanOrEqual(0);
          expect(outcome.ultimateGain).toBeLessThanOrEqual(BALANCE.ultimate.gaugeMax);
        }
      }),
    );
  });

  it('est symetrique : echanger les sieges echange les resultats', () => {
    fc.assert(
      fc.property(seatArb, seatArb, (left, right) => {
        const direct = resolveRound({ a: seat(left), b: seat(right) });
        const inverse = resolveRound({ a: seat(right), b: seat(left) });
        expect(inverse.seats.a.score).toBe(direct.seats.b.score);
        expect(inverse.seats.b.score).toBe(direct.seats.a.score);
        expect(inverse.winner).toBe(
          direct.winner === null ? null : direct.winner === 'a' ? 'b' : 'a',
        );
      }),
    );
  });
});
