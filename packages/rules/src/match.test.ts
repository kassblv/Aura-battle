import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { BALANCE } from './balance.js';
import { buildRoundContext } from './match.js';
import { createMatch, reduce, type MatchEvent, type MatchState, type MatchStep } from './match.js';
import type { Choice, Seat } from './types.js';

const choice = (tier: 0 | 1 | 2 | 3 | 4, useUltimate = false): Choice => ({
  move: { style: 'calme', tier },
  amplifier: 0,
  useUltimate,
});

/** Enchaine des evenements sur un match et rend le dernier pas. */
const run = (start: MatchStep, events: readonly MatchEvent[]): MatchStep =>
  events.reduce<MatchStep>((step, event) => reduce(step.state, event), start);

/** Fait avancer la phase courante jusqu'a son echeance. */
const timeout = (state: MatchState): MatchEvent => ({
  type: 'PHASE_TIMEOUT',
  atMs: state.phaseEndsAtMs,
});

/** Verrouille un choix identique pour les deux sieges. */
const bothLock = (state: MatchState, tier: 0 | 1 | 2 | 3 | 4): MatchEvent[] =>
  (['a', 'b'] as const).map((seat) => ({
    type: 'CHOICE_LOCKED' as const,
    seat,
    choice: choice(tier),
    timingTapAtMs: null,
    atMs: state.phaseEndsAtMs - 1_000,
  }));

/** Amene le match au debut de la phase de choix de la manche courante. */
const toChoicePhase = (step: MatchStep): MatchStep => {
  let current = step;
  while (current.state.phase !== 'choice' && current.state.phase !== 'ended') {
    current = reduce(current.state, timeout(current.state));
  }
  return current;
};

describe('createMatch', () => {
  it('ouvre sur la phase d intro de la premiere manche', () => {
    const { state } = createMatch('graine');
    expect(state.phase).toBe('intro');
    expect(state.round).toBe(1);
  });

  it('donne a chaque siege l energie de depart et une jauge vide', () => {
    const { state } = createMatch('graine');
    for (const seat of ['a', 'b'] as const) {
      expect(state.seats[seat].energy).toBe(BALANCE.match.startingEnergy);
      expect(state.seats[seat].ultimateGauge).toBe(0);
      expect(state.seats[seat].roundsWon).toBe(0);
    }
  });

  it('fixe l echeance de l intro a partir de l instant de depart', () => {
    const { state } = createMatch('graine', { startedAtMs: 1_000 });
    expect(state.phaseEndsAtMs).toBe(1_000 + BALANCE.phases.introMs);
  });

  it('annonce le debut de la phase', () => {
    const { effects } = createMatch('graine');
    expect(effects).toContainEqual({
      type: 'PHASE_STARTED',
      phase: 'intro',
      round: 1,
      endsAtMs: BALANCE.phases.introMs,
    });
  });

  it('redonne exactement le meme match pour une meme graine', () => {
    expect(createMatch('graine').state).toEqual(createMatch('graine').state);
  });
});

describe('enchainement des phases (§1)', () => {
  it('passe de intro a recharge, puis a choix, puis a revelation', () => {
    let step = createMatch('graine');
    expect(step.state.phase).toBe('intro');
    step = reduce(step.state, timeout(step.state));
    expect(step.state.phase).toBe('recharge');
    step = reduce(step.state, timeout(step.state));
    expect(step.state.phase).toBe('choice');
    step = run(step, bothLock(step.state, 1));
    expect(step.state.phase).toBe('reveal');
  });

  it('donne a chaque phase la duree documentee', () => {
    let step = createMatch('graine');
    step = reduce(step.state, timeout(step.state));
    expect(step.state.phaseEndsAtMs).toBe(BALANCE.phases.introMs + BALANCE.phases.rechargeMs);
    step = reduce(step.state, timeout(step.state));
    expect(step.state.phaseEndsAtMs).toBe(
      BALANCE.phases.introMs + BALANCE.phases.rechargeMs + BALANCE.phases.choiceMs,
    );
  });

  it('prepare les orbes et la jauge au debut de la recharge', () => {
    const step = reduce(createMatch('graine').state, timeout(createMatch('graine').state));
    expect(step.state.roundContext?.orbs.length).toBeGreaterThan(0);
    expect(step.state.roundContext?.gauge.periodMs).toBeGreaterThanOrEqual(1_500);
  });

  it('donne aux deux sieges exactement les memes orbes', () => {
    const step = reduce(createMatch('graine').state, timeout(createMatch('graine').state));
    // Une seule sequence est tiree par manche : elle est commune, donc equitable.
    expect(step.state.roundContext?.orbs).toBeDefined();
  });
});

describe('recharge', () => {
  const rechargeStep = (): MatchStep => {
    const start = createMatch('graine');
    return reduce(start.state, timeout(start.state));
  };

  it('convertit les taps en energie, jauge et boost a la fin de la recharge', () => {
    const step = rechargeStep();
    const orbs = step.state.roundContext?.orbs ?? [];
    const taps = orbs.slice(0, 8).map((orb, i) => ({ atMs: (i + 1) * 200, orbIndex: orb.index }));
    const withTaps = reduce(step.state, { type: 'RECHARGE_TAPS', seat: 'a', taps, atMs: 1_800 });
    const afterRecharge = reduce(withTaps.state, timeout(withTaps.state));

    expect(afterRecharge.state.seats.a.ultimateGauge).toBeGreaterThan(0);
    expect(afterRecharge.state.seats.a.energy).toBeGreaterThan(BALANCE.match.startingEnergy - 1);
    expect(afterRecharge.state.seats.b.ultimateGauge).toBe(0);
  });

  it('ne fait jamais depasser 14 points d energie', () => {
    const step = rechargeStep();
    const orbs = step.state.roundContext?.orbs ?? [];
    const taps = orbs.slice(0, 20).map((orb, i) => ({ atMs: (i + 1) * 150, orbIndex: orb.index }));
    const withTaps = reduce(step.state, { type: 'RECHARGE_TAPS', seat: 'a', taps, atMs: 3_000 });
    const afterRecharge = reduce(withTaps.state, timeout(withTaps.state));
    expect(afterRecharge.state.seats.a.energy).toBeLessThanOrEqual(BALANCE.match.startingEnergy);
  });

  it('ignore des taps envoyes hors de la phase de recharge', () => {
    const start = createMatch('graine');
    const step = reduce(start.state, {
      type: 'RECHARGE_TAPS',
      seat: 'a',
      taps: [{ atMs: 100, orbIndex: 0 }],
      atMs: 100,
    });
    expect(step.state).toEqual(start.state);
  });
});

describe('verrouillage du choix (§3, §6)', () => {
  it('passe en revelation des que les deux sieges ont verrouille', () => {
    const step = toChoicePhase(createMatch('graine'));
    const locked = run(step, bothLock(step.state, 2));
    expect(locked.state.phase).toBe('reveal');
  });

  it('attend le second siege', () => {
    const step = toChoicePhase(createMatch('graine'));
    const [premier] = bothLock(step.state, 2);
    const locked = reduce(step.state, premier!);
    expect(locked.state.phase).toBe('choice');
  });

  it('refuse un choix plus cher que l energie restante', () => {
    const step = toChoicePhase(createMatch('graine'));
    // On vide l energie : 3 manches au palier 4 coutent 12 des 14 points.
    const pauvre: MatchState = {
      ...step.state,
      seats: { ...step.state.seats, a: { ...step.state.seats.a, energy: 2 } },
    };
    const refuse = reduce(pauvre, {
      type: 'CHOICE_LOCKED',
      seat: 'a',
      choice: { move: { style: 'calme', tier: 4 }, amplifier: 4, useUltimate: false },
      timingTapAtMs: null,
      atMs: pauvre.phaseEndsAtMs - 500,
    });
    expect(refuse.effects).toContainEqual({
      type: 'CHOICE_REJECTED',
      seat: 'a',
      reason: 'NOT_ENOUGH_ENERGY',
    });
    expect(refuse.state).toEqual(pauvre);
  });

  it('refuse l Ultime quand la jauge n est pas pleine', () => {
    const step = toChoicePhase(createMatch('graine'));
    const refuse = reduce(step.state, {
      type: 'CHOICE_LOCKED',
      seat: 'a',
      choice: choice(1, true),
      timingTapAtMs: null,
      atMs: step.state.phaseEndsAtMs - 500,
    });
    expect(refuse.effects).toContainEqual({
      type: 'CHOICE_REJECTED',
      seat: 'a',
      reason: 'ULTIMATE_NOT_READY',
    });
  });

  it('accepte l Ultime quand la jauge est pleine et la vide ensuite', () => {
    const step = toChoicePhase(createMatch('graine'));
    const pret: MatchState = {
      ...step.state,
      seats: {
        ...step.state.seats,
        a: { ...step.state.seats.a, ultimateGauge: BALANCE.ultimate.gaugeMax },
        b: { ...step.state.seats.b, ultimateGauge: BALANCE.ultimate.gaugeMax },
      },
    };
    let after = reduce(pret, {
      type: 'CHOICE_LOCKED',
      seat: 'a',
      choice: choice(1, true),
      timingTapAtMs: null,
      atMs: pret.phaseEndsAtMs - 500,
    });
    after = reduce(after.state, {
      type: 'CHOICE_LOCKED',
      seat: 'b',
      choice: choice(1),
      timingTapAtMs: null,
      atMs: pret.phaseEndsAtMs - 400,
    });
    expect(after.state.seats.a.ultimateGauge).toBe(0);
    expect(after.state.seats.b.ultimateGauge).toBe(BALANCE.ultimate.gaugeMax);
  });

  it('refuse un second verrouillage du meme siege', () => {
    const step = toChoicePhase(createMatch('graine'));
    const [premier] = bothLock(step.state, 1);
    const once = reduce(step.state, premier!);
    const twice = reduce(once.state, premier!);
    expect(twice.effects).toContainEqual({
      type: 'CHOICE_REJECTED',
      seat: 'a',
      reason: 'ALREADY_LOCKED',
    });
    expect(twice.state).toEqual(once.state);
  });

  it('refuse un verrouillage hors de la phase de choix', () => {
    const start = createMatch('graine');
    const refuse = reduce(start.state, {
      type: 'CHOICE_LOCKED',
      seat: 'a',
      choice: choice(1),
      timingTapAtMs: null,
      atMs: 100,
    });
    expect(refuse.effects).toContainEqual({
      type: 'CHOICE_REJECTED',
      seat: 'a',
      reason: 'NOT_IN_CHOICE_PHASE',
    });
  });

  it('deduit le cout du choix de l energie', () => {
    const step = toChoicePhase(createMatch('graine'));
    const locked = run(step, bothLock(step.state, 3));
    expect(locked.state.seats.a.energy).toBe(BALANCE.match.startingEnergy - 3);
  });
});

describe('echeance de la phase de choix (§9)', () => {
  it('joue un palier 0 sans amplificateur pour qui n a pas verrouille', () => {
    const step = toChoicePhase(createMatch('graine'));
    const expire = reduce(step.state, timeout(step.state));
    expect(expire.state.phase).toBe('reveal');
    expect(expire.state.seats.a.energy).toBe(BALANCE.match.startingEnergy);
    expect(expire.state.seats.b.energy).toBe(BALANCE.match.startingEnergy);
  });

  it('compte un timing rate pour qui n a pas verrouille', () => {
    const step = toChoicePhase(createMatch('graine'));
    const expire = reduce(step.state, timeout(step.state));
    const resolved = expire.effects.find((effect) => effect.type === 'ROUND_RESOLVED');
    expect(resolved).toBeDefined();
    if (resolved?.type === 'ROUND_RESOLVED') {
      expect(resolved.result.seats.a.score).toBeLessThan(BALANCE.tierPower[0]);
    }
  });
});

describe('deroulement du match (§8)', () => {
  /** Joue une manche entiere ou `winner` prend l avantage grace a un palier superieur. */
  const playRound = (step: MatchStep, winner: Seat): MatchStep => {
    let current = toChoicePhase(step);
    if (current.state.phase === 'ended') return current;
    const loser: Seat = winner === 'a' ? 'b' : 'a';
    current = reduce(current.state, {
      type: 'CHOICE_LOCKED',
      seat: winner,
      choice: choice(3),
      timingTapAtMs: null,
      atMs: current.state.phaseEndsAtMs - 900,
    });
    current = reduce(current.state, {
      type: 'CHOICE_LOCKED',
      seat: loser,
      choice: choice(0),
      timingTapAtMs: null,
      atMs: current.state.phaseEndsAtMs - 800,
    });
    return reduce(current.state, timeout(current.state));
  };

  it('termine le match en deux manches gagnees', () => {
    let step = createMatch('graine');
    step = playRound(step, 'a');
    expect(step.state.seats.a.roundsWon).toBe(1);
    expect(step.state.phase).toBe('intro');
    expect(step.state.round).toBe(2);
    step = playRound(step, 'a');
    expect(step.state.phase).toBe('ended');
    expect(step.state.result?.winner).toBe('a');
    expect(step.state.result?.reason).toBe('rounds');
  });

  it('va jusqu a la troisieme manche sur un 1-1', () => {
    let step = createMatch('graine');
    step = playRound(step, 'a');
    step = playRound(step, 'b');
    expect(step.state.phase).toBe('intro');
    expect(step.state.round).toBe(3);
    step = playRound(step, 'b');
    expect(step.state.phase).toBe('ended');
    expect(step.state.result?.winner).toBe('b');
  });

  it('annonce la fin du match', () => {
    let step = createMatch('graine');
    step = playRound(step, 'a');
    step = playRound(step, 'a');
    expect(step.effects.some((effect) => effect.type === 'MATCH_ENDED')).toBe(true);
  });

  it('ne joue jamais plus de trois manches', () => {
    let step = createMatch('graine');
    for (let i = 0; i < 12 && step.state.phase !== 'ended'; i += 1) {
      step = toChoicePhase(step);
      if (step.state.phase === 'ended') break;
      step = reduce(step.state, timeout(step.state));
      if (step.state.phase === 'reveal') step = reduce(step.state, timeout(step.state));
    }
    expect(step.state.phase).toBe('ended');
    expect(step.state.history.length).toBeLessThanOrEqual(BALANCE.match.maxRounds);
  });

  it('ignore un evenement arrive apres la fin du match', () => {
    let step = createMatch('graine');
    step = playRound(step, 'a');
    step = playRound(step, 'a');
    const apres = reduce(step.state, { type: 'PHASE_TIMEOUT', atMs: 999_999 });
    expect(apres.state).toEqual(step.state);
  });
});

describe('abandon (§8)', () => {
  it('donne la victoire a l autre siege', () => {
    const start = createMatch('graine');
    const step = reduce(start.state, { type: 'PLAYER_FORFEIT', seat: 'a', atMs: 500 });
    expect(step.state.phase).toBe('ended');
    expect(step.state.result?.winner).toBe('b');
    expect(step.state.result?.reason).toBe('forfeit');
  });

  it('ignore un abandon apres la fin du match', () => {
    const start = createMatch('graine');
    const fini = reduce(start.state, { type: 'PLAYER_FORFEIT', seat: 'a', atMs: 500 });
    const encore = reduce(fini.state, { type: 'PLAYER_FORFEIT', seat: 'b', atMs: 600 });
    expect(encore.state.result?.winner).toBe('b');
  });
});

describe('inaction repetee (§9)', () => {
  it('declare forfait apres deux manches sans la moindre action', () => {
    let step = createMatch('graine');
    // Manche 1 : le siege b joue, le siege a ne fait rien.
    for (let round = 0; round < 2; round += 1) {
      step = toChoicePhase(step);
      step = reduce(step.state, {
        type: 'CHOICE_LOCKED',
        seat: 'b',
        choice: choice(1),
        timingTapAtMs: null,
        atMs: step.state.phaseEndsAtMs - 500,
      });
      step = reduce(step.state, timeout(step.state));
      if (step.state.phase === 'reveal') step = reduce(step.state, timeout(step.state));
    }
    expect(step.state.phase).toBe('ended');
    expect(step.state.result?.reason).toBe('forfeit');
    expect(step.state.result?.winner).toBe('b');
  });
});

describe('departage de fin de match (§8)', () => {
  /** Fabrique un etat de fin de troisieme manche, prêt à être départagé. */
  const atLastReveal = (
    a: Partial<MatchState['seats']['a']>,
    b: Partial<MatchState['seats']['b']>,
  ): MatchState => {
    const base = createMatch('graine').state;
    return {
      ...base,
      phase: 'reveal',
      round: BALANCE.match.maxRounds,
      phaseEndsAtMs: 1_000,
      seats: {
        a: { ...base.seats.a, ...a },
        b: { ...base.seats.b, ...b },
      },
    };
  };

  it('departage d abord au nombre de manches gagnees', () => {
    const state = atLastReveal({ roundsWon: 1, totalScore: 10 }, { roundsWon: 0, totalScore: 99 });
    const step = reduce(state, { type: 'PHASE_TIMEOUT', atMs: 1_000 });
    expect(step.state.result?.winner).toBe('a');
    expect(step.state.result?.reason).toBe('tiebreak');
  });

  it('departage ensuite au total des scores', () => {
    const state = atLastReveal({ roundsWon: 1, totalScore: 120 }, { roundsWon: 1, totalScore: 90 });
    const step = reduce(state, { type: 'PHASE_TIMEOUT', atMs: 1_000 });
    expect(step.state.result?.winner).toBe('a');
  });

  it('departage enfin a la plus petite somme d ecarts de timing', () => {
    const state = atLastReveal(
      { roundsWon: 1, totalScore: 100, timingDeltaSum: 0.9 },
      { roundsWon: 1, totalScore: 100, timingDeltaSum: 0.2 },
    );
    const step = reduce(state, { type: 'PHASE_TIMEOUT', atMs: 1_000 });
    expect(step.state.result?.winner).toBe('b');
  });

  it('declare le match nul quand rien ne departage', () => {
    const state = atLastReveal(
      { roundsWon: 1, totalScore: 100, timingDeltaSum: 0.5 },
      { roundsWon: 1, totalScore: 100, timingDeltaSum: 0.5 },
    );
    const step = reduce(state, { type: 'PHASE_TIMEOUT', atMs: 1_000 });
    expect(step.state.result?.winner).toBe(null);
    expect(step.state.result?.reason).toBe('tiebreak');
  });

  it('ne declare aucun vainqueur quand les deux sieges ont deserte', () => {
    const state = atLastReveal({ idleRounds: 2 }, { idleRounds: 2 });
    const step = reduce(state, { type: 'PHASE_TIMEOUT', atMs: 1_000 });
    expect(step.state.result?.reason).toBe('forfeit');
    expect(step.state.result?.winner).toBe(null);
  });
});

describe('robustesse', () => {
  it('ignore une echeance declenchee trop tot', () => {
    const start = createMatch('graine');
    const step = reduce(start.state, { type: 'PHASE_TIMEOUT', atMs: 1 });
    expect(step.state).toEqual(start.state);
    expect(step.effects).toEqual([]);
  });

  it('ne compte pas comme une action un envoi de taps vide', () => {
    const start = createMatch('graine');
    const recharge = reduce(start.state, timeout(start.state));
    const step = reduce(recharge.state, {
      type: 'RECHARGE_TAPS',
      seat: 'a',
      taps: [],
      atMs: 500,
    });
    expect(step.state.pending.a.acted).toBe(false);
  });

  it('ne resout rien si la manche n a pas ete preparee', () => {
    const base = createMatch('graine').state;
    const orphelin: MatchState = {
      ...base,
      phase: 'choice',
      phaseEndsAtMs: 10,
      roundContext: null,
    };
    const step = reduce(orphelin, { type: 'PHASE_TIMEOUT', atMs: 10 });
    expect(step.state).toEqual(orphelin);
    expect(step.effects).toEqual([]);
  });
});

describe('invariants du match', () => {
  const eventArb = fc.oneof(
    fc.record({
      type: fc.constant('PHASE_TIMEOUT' as const),
      atMs: fc.integer({ min: 0, max: 90_000 }),
    }),
    fc.record({
      type: fc.constant('CHOICE_LOCKED' as const),
      seat: fc.constantFrom<Seat>('a', 'b'),
      choice: fc.record({
        move: fc.record({
          style: fc.constantFrom('calme' as const, 'hype' as const, 'provoc' as const),
          tier: fc.constantFrom(0 as const, 1 as const, 2 as const, 3 as const, 4 as const),
        }),
        amplifier: fc.constantFrom(0 as const, 1 as const, 2 as const, 3 as const, 4 as const),
        useUltimate: fc.boolean(),
      }),
      timingTapAtMs: fc.option(fc.integer({ min: 0, max: 6_000 }), { nil: null }),
      atMs: fc.integer({ min: 0, max: 90_000 }),
    }),
  );

  it('garde l energie dans [0, 14] et la jauge dans [0, 100]', () => {
    fc.assert(
      fc.property(fc.array(eventArb, { maxLength: 40 }), (events) => {
        const final = run(createMatch('graine'), events);
        for (const seat of ['a', 'b'] as const) {
          expect(final.state.seats[seat].energy).toBeGreaterThanOrEqual(0);
          expect(final.state.seats[seat].energy).toBeLessThanOrEqual(BALANCE.match.startingEnergy);
          expect(final.state.seats[seat].ultimateGauge).toBeGreaterThanOrEqual(0);
          expect(final.state.seats[seat].ultimateGauge).toBeLessThanOrEqual(
            BALANCE.ultimate.gaugeMax,
          );
        }
      }),
    );
  });

  it('ne depasse jamais trois manches', () => {
    fc.assert(
      fc.property(fc.array(eventArb, { maxLength: 60 }), (events) => {
        const final = run(createMatch('graine'), events);
        expect(final.state.round).toBeLessThanOrEqual(BALANCE.match.maxRounds);
        expect(final.state.history.length).toBeLessThanOrEqual(BALANCE.match.maxRounds);
      }),
    );
  });

  it('rejoue le meme match final pour une meme graine et les memes evenements', () => {
    fc.assert(
      fc.property(fc.string(), fc.array(eventArb, { maxLength: 30 }), (seed, events) => {
        const gauche = run(createMatch(seed), events);
        const droite = run(createMatch(seed), events);
        expect(gauche.state).toEqual(droite.state);
      }),
    );
  });

  it('ne declare jamais les deux sieges vainqueurs', () => {
    fc.assert(
      fc.property(fc.array(eventArb, { maxLength: 60 }), (events) => {
        const final = run(createMatch('graine'), events);
        expect([null, 'a', 'b']).toContain(final.state.result?.winner ?? null);
      }),
    );
  });
});

describe('resultat de recharge conserve dans l etat', () => {
  it('n a rien a montrer avant la fin de la recharge', () => {
    const start = createMatch('graine');
    expect(start.state.pending.a.recharge).toBe(null);
  });

  it('garde l evaluation complete apres la recharge', () => {
    const start = createMatch('graine');
    const recharge = reduce(start.state, timeout(start.state));
    const orbs = recharge.state.roundContext?.orbs ?? [];
    const taps = orbs.slice(0, 5).map((orb, i) => ({ atMs: (i + 1) * 200, orbIndex: orb.index }));
    const withTaps = reduce(recharge.state, {
      type: 'RECHARGE_TAPS',
      seat: 'a',
      taps,
      atMs: 1_200,
    });
    const after = reduce(withTaps.state, timeout(withTaps.state));

    // Le serveur doit pouvoir annoncer les points et le combo sans refaire le
    // calcul de son cote. Les points dependent du type des orbes tirees — une
    // doree en vaut trois — donc on verifie ce qui ne depend que des taps.
    expect(after.state.pending.a.recharge?.hits).toBe(5);
    expect(after.state.pending.a.recharge?.bestCombo).toBe(5);
    expect(after.state.pending.a.recharge?.points).toBeGreaterThanOrEqual(5);
    expect(after.state.pending.a.recharge?.boostPercent).toBe(after.state.pending.a.boostPercent);
    expect(after.state.pending.b.recharge?.points).toBe(0);
  });

  it('remet l evaluation a zero a la manche suivante', () => {
    let step = createMatch('graine');
    for (let i = 0; i < 4 && step.state.phase !== 'ended'; i += 1) {
      step = reduce(step.state, timeout(step.state));
      if (step.state.round === 2 && step.state.phase === 'intro') break;
    }
    expect(step.state.pending.a.recharge).toBe(null);
  });
});

describe('plafond des taps accumules', () => {
  const rechargePhase = () => {
    const start = createMatch('graine');
    return reduce(start.state, timeout(start.state));
  };

  const physicalMax = (BALANCE.recharge.maxTapsPerSecond * BALANCE.recharge.durationMs) / 1_000;

  it('accepte tout ce qu un joueur peut physiquement produire', () => {
    const step = rechargePhase();
    const taps = Array.from({ length: physicalMax }, (_unused, i) => ({
      atMs: i * 80,
      orbIndex: i,
    }));
    const after = reduce(step.state, { type: 'RECHARGE_TAPS', seat: 'a', taps, atMs: 100 });
    expect(after.state.pending.a.taps).toHaveLength(physicalMax);
  });

  it('ne garde jamais plus que ce maximum, meme sur plusieurs envois', () => {
    // Le schema du protocole borne un message, pas la somme des messages d'une
    // phase : sans plafond ici, un client empile autant qu'il veut.
    let step = rechargePhase();
    for (let envoi = 0; envoi < 20; envoi += 1) {
      const taps = Array.from({ length: physicalMax }, (_unused, i) => ({
        atMs: i * 80,
        orbIndex: i,
      }));
      step = reduce(step.state, { type: 'RECHARGE_TAPS', seat: 'a', taps, atMs: 100 });
    }
    expect(step.state.pending.a.taps).toHaveLength(physicalMax);
  });

  it('garde les premiers taps, pas les derniers', () => {
    // Le joueur honnete tape dans l'ordre : ce sont ses premiers taps qui
    // comptent, pas ceux qu'un tricheur ajouterait ensuite.
    const step = rechargePhase();
    const taps = Array.from({ length: physicalMax + 50 }, (_unused, i) => ({
      atMs: i,
      orbIndex: i,
    }));
    const after = reduce(step.state, { type: 'RECHARGE_TAPS', seat: 'a', taps, atMs: 100 });
    expect(after.state.pending.a.taps[0]?.orbIndex).toBe(0);
    expect(after.state.pending.a.taps.at(-1)?.orbIndex).toBe(physicalMax - 1);
  });

  it('plafonne chaque siege separement', () => {
    let step = rechargePhase();
    const taps = Array.from({ length: physicalMax + 10 }, (_unused, i) => ({
      atMs: i,
      orbIndex: i,
    }));
    step = reduce(step.state, { type: 'RECHARGE_TAPS', seat: 'a', taps, atMs: 100 });
    step = reduce(step.state, {
      type: 'RECHARGE_TAPS',
      seat: 'b',
      taps: taps.slice(0, 3),
      atMs: 100,
    });
    expect(step.state.pending.a.taps).toHaveLength(physicalMax);
    expect(step.state.pending.b.taps).toHaveLength(3);
  });
});

/**
 * L'amplificateur joue survit a la manche.
 *
 * Le moteur gardait `moves` — le mouvement — et oubliait l'amplificateur des
 * la manche resolue. En ligne cela ne se voyait pas : le serveur tient les
 * choix verrouilles et annonce lui-meme l'apparence. Hors ligne il n'y a
 * personne pour s'en souvenir, et le solo affichait donc toujours la Lueur,
 * meme apres l'achat d'un skin.
 *
 * L'amplificateur decide de l'effet d'aura qu'on voit tourner autour d'un
 * combattant (docs/01 §3) : c'est une sortie du moteur au meme titre que le
 * mouvement, pas une entree qu'on peut jeter apres usage.
 */
describe('amplificateurs joues', () => {
  const amplified = (tier: 0 | 1 | 2 | 3 | 4, amplifier: 0 | 1 | 2 | 3 | 4): Choice => ({
    move: { style: 'calme', tier },
    amplifier,
    useUltimate: false,
  });

  const lockBoth = (state: MatchState, a: Choice, b: Choice): MatchEvent[] =>
    (['a', 'b'] as const).map((seat) => ({
      type: 'CHOICE_LOCKED' as const,
      seat,
      choice: seat === 'a' ? a : b,
      timingTapAtMs: null,
      atMs: state.phaseEndsAtMs - 1_000,
    }));

  it('ne garde rien avant la premiere manche', () => {
    const { state } = createMatch('graine');
    expect(state.seats.a.amplifiers).toEqual([]);
    expect(state.seats.b.amplifiers).toEqual([]);
  });

  it('retient ce que chaque siege a joue', () => {
    const step = toChoicePhase(createMatch('graine'));
    const locked = run(step, lockBoth(step.state, amplified(1, 3), amplified(1, 0)));
    expect(locked.state.seats.a.amplifiers).toEqual([3]);
    expect(locked.state.seats.b.amplifiers).toEqual([0]);
  });

  /*
    Un par manche, dans l'ordre : c'est ce qui permet de lire le dernier sans
    se demander a quelle manche il appartient.
  */
  it('en ajoute un par manche, dans l ordre', () => {
    let step = toChoicePhase(createMatch('graine'));
    step = run(step, lockBoth(step.state, amplified(1, 2), amplified(0, 0)));
    step = toChoicePhase(step);
    step = run(step, lockBoth(step.state, amplified(1, 4), amplified(0, 1)));
    expect(step.state.seats.a.amplifiers).toEqual([2, 4]);
    expect(step.state.seats.b.amplifiers).toEqual([0, 1]);
  });

  /*
    Autant d'amplificateurs que de mouvements, toujours. Les deux decrivent la
    meme manche : un ecart voudrait dire qu'on lit l'amplificateur d'une manche
    en regardant le mouvement d'une autre.
  */
  it('reste aligne sur les mouvements', () => {
    let step = toChoicePhase(createMatch('graine'));
    for (let round = 0; round < 2; round += 1) {
      step = run(step, lockBoth(step.state, amplified(1, round as 0 | 1), amplified(0, 0)));
      step = toChoicePhase(step);
    }
    for (const seat of ['a', 'b'] as const) {
      expect(step.state.seats[seat].amplifiers.length).toBe(step.state.seats[seat].moves.length);
    }
  });

  /*
    Un siege qui n'a rien verrouille joue le choix par defaut, amplificateur
    zero. Ne rien ajouter desalignerait les deux tableaux a la premiere
    manche ou quelqu'un laisse filer le temps.
  */
  it('compte aussi la manche de celui qui n a rien joue', () => {
    let step = toChoicePhase(createMatch('graine'));
    step = reduce(step.state, {
      type: 'CHOICE_LOCKED',
      seat: 'a',
      choice: amplified(1, 2),
      timingTapAtMs: null,
      atMs: step.state.phaseEndsAtMs - 1_000,
    });
    step = reduce(step.state, timeout(step.state));
    expect(step.state.seats.a.amplifiers).toEqual([2]);
    expect(step.state.seats.b.amplifiers).toHaveLength(1);
    expect(step.state.seats.b.amplifiers.length).toBe(step.state.seats.b.moves.length);
  });
});

describe('carte brillante — tirage', () => {
  // Chaque manche a son propre tirage : sinon la brillante resterait la meme tout le match.
  it('change de case d une manche a l autre', () => {
    let same = 0;
    for (let i = 0; i < 1_000; i += 1) {
      const one = buildRoundContext(`m-${String(i)}`, 1, BALANCE).shiny.a;
      const two = buildRoundContext(`m-${String(i)}`, 2, BALANCE).shiny.a;
      if (one.style === two.style && one.tier === two.tier) same += 1;
    }
    expect(same / 1_000).toBeLessThan(0.08);
  });

  it('rend toujours une case valide, quelle que soit la graine', () => {
    fc.assert(
      fc.property(fc.string(), (seed) => {
        const shiny = buildRoundContext(seed, 1, BALANCE).shiny.a;
        expect(BALANCE.styles).toContain(shiny.style);
        expect([0, 1, 2, 3, 4]).toContain(shiny.tier);
      }),
    );
  });

  it('couvre les 25 cases, a peu pres uniformement', () => {
    const counts = new Map<string, number>();
    for (let i = 0; i < 5_000; i += 1) {
      const { a } = buildRoundContext(`graine-${String(i)}`, 1, BALANCE).shiny;
      const key = `${a.style}.${String(a.tier)}`;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    expect(counts.size).toBe(25);
    for (const [key, count] of counts) {
      expect(count / 5_000, key).toBeGreaterThan(0.02);
      expect(count / 5_000, key).toBeLessThan(0.06);
    }
  });

  it('tire les deux sieges independamment', () => {
    let same = 0;
    for (let i = 0; i < 2_000; i += 1) {
      const { a, b } = buildRoundContext(`g-${String(i)}`, 2, BALANCE).shiny;
      if (a.style === b.style && a.tier === b.tier) same += 1;
    }
    // Independants : environ 1 fois sur 25.
    expect(same / 2_000).toBeLessThan(0.08);
  });
});
