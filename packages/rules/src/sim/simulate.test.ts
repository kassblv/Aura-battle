import { describe, expect, it } from 'vitest';
import { BALANCE } from '../balance.js';
import { choiceCost } from '../round.js';
import { createRng } from '../rng.js';
import { STRATEGIES, STRATEGY_IDS, type StrategyId } from './strategies.js';
import { runTournament, simulateMatch } from './simulate.js';

describe('STRATEGIES', () => {
  it('expose les cinq strategies de la roadmap', () => {
    expect([...STRATEGY_IDS].sort()).toEqual(
      ['allin', 'counter', 'greedy', 'random', 'thrifty'].sort(),
    );
  });

  it('ne propose jamais un choix au-dessus de l energie disponible', () => {
    for (const id of STRATEGY_IDS) {
      const rng = createRng(`budget-${id}`);
      for (let energy = 0; energy <= BALANCE.match.startingEnergy; energy += 1) {
        const choice = STRATEGIES[id].decideChoice({
          rng,
          energy,
          ultimateGauge: 0,
          previousMoves: [],
          opponentStyles: [],
          round: 1,
          roundsWon: 0,
          opponentRoundsWon: 0,
        });
        expect(choiceCost(choice)).toBeLessThanOrEqual(energy);
      }
    }
  });

  it('fait depenser plus au glouton qu a l econome', () => {
    const depense = (id: StrategyId): number => {
      const rng = createRng('depense');
      let total = 0;
      for (let i = 0; i < 100; i += 1) {
        total += choiceCost(
          STRATEGIES[id].decideChoice({
            rng,
            energy: BALANCE.match.startingEnergy,
            ultimateGauge: 0,
            previousMoves: [],
            opponentStyles: [],
            round: 1,
            roundsWon: 0,
            opponentRoundsWon: 0,
          }),
        );
      }
      return total;
    };
    expect(depense('greedy')).toBeGreaterThan(depense('thrifty'));
  });

  it('fait contrer le contre-picker quand il connait le dernier style adverse', () => {
    const choice = STRATEGIES.counter.decideChoice({
      rng: createRng('contre'),
      energy: BALANCE.match.startingEnergy,
      ultimateGauge: 0,
      previousMoves: [],
      opponentStyles: ['hype'],
      round: 2,
      roundsWon: 0,
      opponentRoundsWon: 0,
    });
    expect(BALANCE.styleBeats[choice.move.style]).toBe('hype');
  });
});

describe('simulateMatch', () => {
  it('termine toujours sur un resultat', () => {
    for (let i = 0; i < 50; i += 1) {
      const match = simulateMatch(`graine-${i}`, {
        a: STRATEGIES.random,
        b: STRATEGIES.greedy,
      });
      expect(match.result).not.toBeNull();
      expect(match.rounds.length).toBeGreaterThanOrEqual(1);
      expect(match.rounds.length).toBeLessThanOrEqual(BALANCE.match.maxRounds);
    }
  });

  it('rejoue exactement le meme match pour une meme graine', () => {
    const jouer = () => simulateMatch('rejeu', { a: STRATEGIES.counter, b: STRATEGIES.thrifty });
    expect(jouer()).toEqual(jouer());
  });

  it('ne laisse jamais l energie devenir negative', () => {
    for (let i = 0; i < 30; i += 1) {
      const match = simulateMatch(`energie-${i}`, {
        a: STRATEGIES.allin,
        b: STRATEGIES.greedy,
      });
      expect(match.finalEnergy.a).toBeGreaterThanOrEqual(0);
      expect(match.finalEnergy.b).toBeGreaterThanOrEqual(0);
    }
  });

  it('donne des matchs differents pour des graines differentes', () => {
    const premier = simulateMatch('graine-1', { a: STRATEGIES.random, b: STRATEGIES.random });
    const second = simulateMatch('graine-2', { a: STRATEGIES.random, b: STRATEGIES.random });
    expect(premier).not.toEqual(second);
  });
});

describe('runTournament', () => {
  const report = runTournament({ matches: 200, seed: 'tournoi' });

  it('joue le nombre de matchs demande', () => {
    expect(report.matches).toBe(200);
  });

  it('rend un taux de victoire dans [0, 1] pour chaque strategie', () => {
    for (const id of STRATEGY_IDS) {
      const rate = report.winRateByStrategy[id];
      expect(rate).toBeGreaterThanOrEqual(0);
      expect(rate).toBeLessThanOrEqual(1);
    }
  });

  it('mesure le taux de victoire par style', () => {
    for (const style of BALANCE.styles) {
      expect(report.winRateByStyle[style]).toBeGreaterThanOrEqual(0);
      expect(report.winRateByStyle[style]).toBeLessThanOrEqual(1);
    }
  });

  it('mesure le taux de victoire par palier', () => {
    expect(Object.keys(report.winRateByTier)).toHaveLength(5);
  });

  it('repartit les matchs entre 2-0, 2-1 et departage', () => {
    const { twoNil, twoOne, tiebreak } = report.finishes;
    expect(twoNil + twoOne + tiebreak).toBe(report.matches);
  });

  it('mesure le taux de manches nulles', () => {
    expect(report.drawRoundRate).toBeGreaterThanOrEqual(0);
    expect(report.drawRoundRate).toBeLessThanOrEqual(1);
  });

  it('mesure l avantage d un bon timeur', () => {
    // 60 % de parfaits contre 20 % : le bon timeur doit dominer.
    expect(report.timingAdvantage).toBeGreaterThan(0.5);
  });

  it('ne divise par zero sur aucun taux quand aucun match n est joue', () => {
    const vide = runTournament({ matches: 0, seed: 'vide' });
    expect(vide.matches).toBe(0);
    expect(vide.drawRoundRate).toBe(0);
    for (const id of STRATEGY_IDS) {
      expect(vide.winRateByStrategy[id]).toBe(0);
    }
  });

  it('rejoue le meme rapport pour une meme graine', () => {
    expect(runTournament({ matches: 40, seed: 'stable' })).toEqual(
      runTournament({ matches: 40, seed: 'stable' }),
    );
  });
});
