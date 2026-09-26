import { describe, expect, it } from 'vitest';
import { BALANCE, type BalanceConfig } from './balance.js';
import { createMatch, reduce, type MatchEvent, type MatchState, type MatchStep } from './match.js';
import type { Choice, Seat, Style } from './types.js';

/*
  Bulle d'intention (docs/01 §10) : en phase de choix, avant son verrouillage,
  une annonce publique par manche — vraie ou bluff. Gagner la manche avec la
  famille annoncee rapporte +10 de jauge d'Ultime. Desactivee par defaut ; le
  serveur l'active match par match (test A/B).
*/
const ON: BalanceConfig = { ...BALANCE, intent: { ...BALANCE.intent, enabled: true } };

const timeout = (state: MatchState): MatchEvent => ({
  type: 'PHASE_TIMEOUT',
  atMs: state.phaseEndsAtMs,
});

const toChoice = (config: BalanceConfig): MatchStep => {
  let step = createMatch('graine-bulle', { config });
  while (step.state.phase !== 'choice') step = reduce(step.state, timeout(step.state), config);
  return step;
};

const announce = (seat: Seat, style: Style, state: MatchState): MatchEvent => ({
  type: 'INTENT_SHOWN',
  seat,
  style,
  atMs: state.phaseEndsAtMs - 5_000,
});

const lock = (seat: Seat, choice: Choice, state: MatchState): MatchEvent => ({
  type: 'CHOICE_LOCKED',
  seat,
  choice,
  timingTapAtMs: null,
  atMs: state.phaseEndsAtMs - 1_000,
});

// Prouesse bat Calme : a gagne la manche par le contre.
const WINNER: Choice = { move: { style: 'prouesse', tier: 2 }, amplifier: 0, useUltimate: false };
const LOSER: Choice = { move: { style: 'calme', tier: 0 }, amplifier: 0, useUltimate: false };

const play = (events: (state: MatchState) => MatchEvent[], config: BalanceConfig = ON) => {
  let step = toChoice(config);
  for (const event of events(step.state)) step = reduce(step.state, event, config);
  return step;
};

describe('bulle d intention — l annonce', () => {
  it('rend l annonce publique aussitot', () => {
    const step = play((s) => [announce('a', 'hype', s)]);
    expect(step.effects).toContainEqual({
      type: 'INTENT_SHOWN',
      seat: 'a',
      style: 'hype',
      round: 1,
    });
    expect(step.state.pending.a.intent).toBe('hype');
  });

  it('ne garde que la premiere annonce de la manche', () => {
    const step = play((s) => [announce('a', 'hype', s), announce('a', 'calme', s)]);
    expect(step.effects).toEqual([]);
    expect(step.state.pending.a.intent).toBe('hype');
  });

  it('refuse une annonce apres son propre verrouillage', () => {
    const step = play((s) => [lock('a', WINNER, s), announce('a', 'prouesse', s)]);
    expect(step.effects).toEqual([]);
    expect(step.state.pending.a.intent).toBeNull();
  });

  it('refuse une annonce hors de la phase de choix', () => {
    let step = createMatch('graine-bulle', { config: ON });
    step = reduce(step.state, announce('a', 'hype', step.state), ON);
    expect(step.effects).toEqual([]);
    expect(step.state.pending.a.intent).toBeNull();
  });

  it('refuse toute annonce quand la bulle est desactivee (defaut)', () => {
    const step = play((s) => [announce('a', 'hype', s)], BALANCE);
    expect(step.effects).toEqual([]);
    expect(step.state.pending.a.intent).toBeNull();
  });

  it('efface les annonces a la manche suivante', () => {
    let step = play((s) => [
      announce('a', 'prouesse', s),
      lock('a', WINNER, s),
      lock('b', LOSER, s),
    ]);
    while (step.state.phase !== 'choice') step = reduce(step.state, timeout(step.state), ON);
    expect(step.state.round).toBe(2);
    expect(step.state.pending.a.intent).toBeNull();
  });
});

describe('bulle d intention — le bonus', () => {
  const resolved = (step: MatchStep) => {
    const effect = step.effects.find((e) => e.type === 'ROUND_RESOLVED');
    if (effect?.type !== 'ROUND_RESOLVED') throw new Error('manche non resolue');
    return effect.result;
  };

  it('donne +10 de jauge a qui gagne avec la famille annoncee', () => {
    const step = play((s) => [
      announce('a', 'prouesse', s),
      lock('a', WINNER, s),
      lock('b', LOSER, s),
    ]);
    const result = resolved(step);
    expect(result.winner).toBe('a');
    expect(result.seats.a.intentKept).toBe(true);
    expect(result.seats.a.ultimateGain).toBe(
      BALANCE.ultimate.gainOnCounter + BALANCE.intent.ultimateBonus,
    );
    expect(step.state.seats.a.ultimateGauge).toBe(
      BALANCE.ultimate.gainOnCounter + BALANCE.intent.ultimateBonus,
    );
  });

  it('ne donne rien a un bluff gagnant', () => {
    const step = play((s) => [announce('a', 'hype', s), lock('a', WINNER, s), lock('b', LOSER, s)]);
    expect(resolved(step).seats.a.intentKept).toBe(false);
    expect(resolved(step).seats.a.ultimateGain).toBe(BALANCE.ultimate.gainOnCounter);
  });

  it('ne donne rien a une annonce sincere mais perdante', () => {
    const step = play((s) => [
      announce('b', 'calme', s),
      lock('a', WINNER, s),
      lock('b', LOSER, s),
    ]);
    expect(resolved(step).seats.b.intentKept).toBe(false);
    expect(resolved(step).seats.b.ultimateGain).toBe(BALANCE.ultimate.gainOnRoundLost);
  });

  it('respecte le plafond de la jauge', () => {
    const tiny: BalanceConfig = { ...ON, ultimate: { ...ON.ultimate, gaugeMax: 40 } };
    const step = play(
      (s) => [announce('a', 'prouesse', s), lock('a', WINNER, s), lock('b', LOSER, s)],
      tiny,
    );
    expect(step.state.seats.a.ultimateGauge).toBe(40);
  });

  it('vaut 10, comme le dit docs/01 §10', () => {
    expect(BALANCE.intent).toEqual({ enabled: false, ultimateBonus: 10 });
  });
});

/*
  « Deux manches consecutives sans aucune action : forfait » (§9). Annoncer
  EST une action : un joueur qui parle a l'adversaire est present, meme s'il
  laisse filer le verrouillage.
*/
describe('bulle d intention — une annonce est une action', () => {
  it('marque le siege comme actif', () => {
    const step = play((s) => [announce('a', 'hype', s)]);
    expect(step.state.pending.a.acted).toBe(true);
  });

  it('une annonce refusee ne compte pas', () => {
    const step = play((s) => [announce('a', 'hype', s)], BALANCE);
    expect(step.state.pending.a.acted).toBe(false);
  });
});
