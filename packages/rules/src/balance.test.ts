import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { BALANCE } from './balance.js';
import { beatersOf, beats } from './counters.js';

/**
 * Ces tests recopient `docs/01-game-design.md`, qui fait foi. Toute valeur
 * changee ici doit l'etre aussi dans le document, et inversement.
 */
describe('BALANCE — structure du match (§1)', () => {
  it('se joue au meilleur des 3 manches', () => {
    expect(BALANCE.match.roundsToWin).toBe(2);
    expect(BALANCE.match.maxRounds).toBe(3);
  });

  it('donne 14 points d energie pour tout le match', () => {
    expect(BALANCE.match.startingEnergy).toBe(14);
  });

  it('enchaine les phases aux durees documentees', () => {
    expect(BALANCE.phases.introMs).toBe(2_000);
    expect(BALANCE.phases.rechargeMs).toBe(6_000);
    expect(BALANCE.phases.choiceMs).toBe(15_000);
    expect(BALANCE.phases.revealMs).toBe(4_500);
  });
});

describe('BALANCE — la roue des cinq familles (§2)', () => {
  it('garde les trois contres historiques', () => {
    expect(beats('calme', 'hype')).toBe(true);
    expect(beats('hype', 'provoc')).toBe(true);
    expect(beats('provoc', 'calme')).toBe(true);
  });

  it('pose les contres des deux nouvelles familles', () => {
    expect(BALANCE.styleBeats).toEqual({
      calme: ['hype', 'acrobatie'],
      hype: ['provoc', 'prouesse'],
      provoc: ['acrobatie', 'calme'],
      acrobatie: ['prouesse', 'hype'],
      prouesse: ['calme', 'provoc'],
    });
  });

  it('applique 1,35 au contre et 0,85 au contre subi', () => {
    expect(BALANCE.counter.winnerMultiplier).toBe(1.35);
    expect(BALANCE.counter.loserMultiplier).toBe(0.85);
  });

  const family = fc.constantFrom(...BALANCE.styles);

  it('chaque famille en bat exactement deux et perd contre exactement deux', () => {
    fc.assert(
      fc.property(family, (style) => {
        expect(BALANCE.styleBeats[style]).toHaveLength(2);
        expect(beatersOf(style)).toHaveLength(2);
      }),
    );
  });

  it('aucune paire n est a la fois gagnante et perdante, et personne ne se bat', () => {
    fc.assert(
      fc.property(family, family, (a, b) => {
        if (a === b) expect(beats(a, b)).toBe(false);
        else expect(beats(a, b)).not.toBe(beats(b, a));
      }),
    );
  });

  it('gele les listes de contres', () => {
    expect(Object.isFrozen(BALANCE.styleBeats.calme)).toBe(true);
  });
});

describe('BALANCE — paliers (§2)', () => {
  it('donne les puissances du tableau', () => {
    expect(BALANCE.tierPower).toEqual({ 0: 11, 1: 20, 2: 30, 3: 42, 4: 56 });
  });

  it('fait couter le palier son propre numero en energie', () => {
    expect(BALANCE.tierCost).toEqual({ 0: 0, 1: 1, 2: 2, 3: 3, 4: 4 });
  });

  it('rend chaque palier strictement plus puissant que le precedent', () => {
    for (const tier of [1, 2, 3, 4] as const) {
      expect(BALANCE.tierPower[tier]).toBeGreaterThan(
        BALANCE.tierPower[(tier - 1) as 0 | 1 | 2 | 3],
      );
    }
  });
});

describe('BALANCE — amplificateurs (§3)', () => {
  it('donne les multiplicateurs du tableau', () => {
    expect(BALANCE.amplifierMultiplier).toEqual({ 0: 1.0, 1: 1.12, 2: 1.25, 3: 1.4, 4: 1.55 });
  });

  it('fait couter l amplificateur son propre niveau', () => {
    expect(BALANCE.amplifierCost).toEqual({ 0: 0, 1: 1, 2: 2, 3: 3, 4: 4 });
  });

  it('garde l amplificateur assez discret pour que le talent puisse compenser', () => {
    // Tout le talent reuni — contre parfait et timing parfait — vaut x2,03.
    // L'amplificateur maximal doit rester en dessous, sinon l'energie
    // excedentaire l'emporte sur le jeu (voir docs/balance/2026-09-17).
    const talentMax = BALANCE.counter.winnerMultiplier * BALANCE.timing.qualityMultiplier.perfect;
    expect(BALANCE.amplifierMultiplier[4]).toBeLessThan(talentMax);
  });

  it('plafonne le cout d une manche a 8', () => {
    expect(BALANCE.maxRoundCost).toBe(8);
  });

  it('rend le plafond de cout atteignable par le choix le plus cher', () => {
    expect(BALANCE.tierCost[4] + BALANCE.amplifierCost[4]).toBe(BALANCE.maxRoundCost);
  });
});

describe('BALANCE — recharge (§4)', () => {
  it('montre 3 orbes en permanence pendant 6 secondes', () => {
    expect(BALANCE.recharge.durationMs).toBe(6_000);
    expect(BALANCE.recharge.visibleOrbs).toBe(3);
  });

  it('decrit l orbe normale et l orbe doree', () => {
    expect(BALANCE.recharge.normalOrb).toEqual({ points: 1, lifetimeMs: 1_600 });
    expect(BALANCE.recharge.goldenOrb).toEqual({ points: 3, lifetimeMs: 950, probability: 0.13 });
  });

  it('bonifie le combat a partir de 10 orbes d affilee', () => {
    expect(BALANCE.recharge.comboThreshold).toBe(10);
    expect(BALANCE.recharge.comboBonusPoints).toBe(1);
  });

  it('convertit les points en boost, en Ultime et en energie', () => {
    expect(BALANCE.recharge.boostPercentPerPoint).toBe(1);
    expect(BALANCE.recharge.boostPercentMax).toBe(25);
    expect(BALANCE.recharge.ultimatePerPoint).toBe(2.5);
    expect(BALANCE.recharge.ultimateMaxPerRecharge).toBe(40);
    expect(BALANCE.recharge.pointsPerEnergy).toBe(8);
    expect(BALANCE.recharge.energyMaxPerRound).toBe(2);
  });

  it('plafonne la validation a 12 taps par seconde', () => {
    expect(BALANCE.recharge.maxTapsPerSecond).toBe(12);
  });
});

describe('BALANCE — timing (§5)', () => {
  it('tire la periode entre 1500 et 1900 ms', () => {
    expect(BALANCE.timing.periodMinMs).toBe(1_500);
    expect(BALANCE.timing.periodMaxMs).toBe(1_900);
  });

  it('tire le centre entre 0,30 et 0,70', () => {
    expect(BALANCE.timing.centerMin).toBe(0.3);
    expect(BALANCE.timing.centerMax).toBe(0.7);
  });

  it('donne une zone parfaite plus etroite que la bonne zone', () => {
    expect(BALANCE.timing.perfectWidth).toBe(0.08);
    expect(BALANCE.timing.zoneWidth).toBe(0.22);
    expect(BALANCE.timing.perfectWidth).toBeLessThan(BALANCE.timing.zoneWidth);
  });

  it('recompense le parfait, tolere le bon, punit le rate', () => {
    expect(BALANCE.timing.qualityMultiplier.perfect).toBe(1.5);
    expect(BALANCE.timing.qualityMultiplier.good).toBe(1.15);
    expect(BALANCE.timing.qualityMultiplier.miss).toBe(0.6);
  });

  it('laisse au plus 6 secondes pour taper', () => {
    expect(BALANCE.timing.maxChargeMs).toBe(6_000);
  });
});

describe('BALANCE — Ultime (§6)', () => {
  it('remplit une jauge de 0 a 100', () => {
    expect(BALANCE.ultimate.gaugeMax).toBe(100);
  });

  it('recompense le parfait, le contre et la manche perdue', () => {
    expect(BALANCE.ultimate.gainOnPerfect).toBe(40);
    expect(BALANCE.ultimate.gainOnCounter).toBe(35);
    expect(BALANCE.ultimate.gainOnRoundLost).toBe(25);
  });

  it('multiplie le score par 1,5', () => {
    expect(BALANCE.ultimate.multiplier).toBe(1.5);
  });
});

describe('BALANCE — score (§7)', () => {
  it('penalise la repetition d un mouvement', () => {
    expect(BALANCE.repeatMultiplier).toBe(0.7);
  });
});

describe('BALANCE — gel', () => {
  it('est gele en surface', () => {
    expect(Object.isFrozen(BALANCE)).toBe(true);
  });

  it('est gele en profondeur', () => {
    expect(Object.isFrozen(BALANCE.recharge)).toBe(true);
    expect(Object.isFrozen(BALANCE.recharge.goldenOrb)).toBe(true);
    expect(Object.isFrozen(BALANCE.timing.qualityMultiplier)).toBe(true);
    expect(Object.isFrozen(BALANCE.tierPower)).toBe(true);
    expect(Object.isFrozen(BALANCE.styles)).toBe(true);
  });

  it('refuse toute modification a l execution', () => {
    expect(() => {
      (BALANCE.match as { startingEnergy: number }).startingEnergy = 99;
    }).toThrow(TypeError);
  });
});
