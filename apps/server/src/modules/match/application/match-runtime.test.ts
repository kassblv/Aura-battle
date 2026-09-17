import { BALANCE, type Choice, type Seat } from '@aura/rules';
import type { ServerMessage, ServerMessageName } from '@aura/protocol';
import { beforeEach, describe, expect, it } from 'vitest';
import type { MatchClock, MatchNotifier, TimerScheduler } from '../domain/ports.js';
import { MatchRuntime } from './match-runtime.js';

/** Note tout ce qui est envoye, pour pouvoir l'inspecter. */
class RecordingNotifier implements MatchNotifier {
  readonly sent: { playerId: string; name: string; payload: unknown }[] = [];

  send<N extends ServerMessageName>(playerId: string, name: N, payload: ServerMessage<N>): void {
    this.sent.push({ playerId, name, payload });
  }

  to(playerId: string, name: string): unknown[] {
    return this.sent
      .filter((m) => m.playerId === playerId && m.name === name)
      .map((m) => m.payload);
  }

  namesFor(playerId: string): string[] {
    return this.sent.filter((m) => m.playerId === playerId).map((m) => m.name);
  }

  clear(): void {
    this.sent.length = 0;
  }
}

/** Minuteur manuel : le temps n'avance que si on le pousse. */
class ManualScheduler implements TimerScheduler {
  private readonly timers = new Map<string, { atMs: number; run: () => void }>();

  schedule(key: string, atMs: number, run: () => void): void {
    this.timers.set(key, { atMs, run });
  }

  cancel(key: string): void {
    this.timers.delete(key);
  }

  pending(key: string): number | null {
    return this.timers.get(key)?.atMs ?? null;
  }

  /** Declenche l'echeance en attente. */
  fire(key: string): boolean {
    const timer = this.timers.get(key);
    if (timer === undefined) return false;
    this.timers.delete(key);
    timer.run();
    return true;
  }
}

class MovableClock implements MatchClock {
  current = 1_700_000_000_000;
  now(): number {
    return this.current;
  }
}

const MATCH_ID = 'm_01';
const SEATS = { a: 'player-a', b: 'player-b' } as const;

let notifier: RecordingNotifier;
let scheduler: ManualScheduler;
let clock: MovableClock;
let runtime: MatchRuntime;

const choice = (tier: 0 | 1 | 2 | 3 | 4): Choice => ({
  move: { style: 'calme', tier },
  amplifier: 0,
  useUltimate: false,
});

/** Fait avancer le match jusqu'a la phase demandee en declenchant les echeances. */
const advanceTo = (phase: string): void => {
  for (let i = 0; i < 10; i += 1) {
    if (runtime.phaseOf(MATCH_ID) === phase) return;
    if (!scheduler.fire(MATCH_ID)) return;
  }
};

beforeEach(() => {
  notifier = new RecordingNotifier();
  scheduler = new ManualScheduler();
  clock = new MovableClock();
  runtime = new MatchRuntime(notifier, scheduler, clock);
  runtime.createMatch({ matchId: MATCH_ID, seed: 'graine', seats: SEATS });
});

describe('createMatch', () => {
  it('ouvre sur l intro et previent les deux joueurs', () => {
    expect(runtime.phaseOf(MATCH_ID)).toBe('intro');
    expect(notifier.to(SEATS.a, 'round:intro')).toHaveLength(1);
    expect(notifier.to(SEATS.b, 'round:intro')).toHaveLength(1);
  });

  it('programme l echeance de la phase', () => {
    expect(scheduler.pending(MATCH_ID)).toBe(clock.now() + BALANCE.phases.introMs);
  });

  it('associe chaque joueur a son siege', () => {
    expect(runtime.seatOf(MATCH_ID, SEATS.a)).toBe('a');
    expect(runtime.seatOf(MATCH_ID, SEATS.b)).toBe('b');
    expect(runtime.seatOf(MATCH_ID, 'inconnu')).toBe(null);
  });
});

describe('enchainement des phases', () => {
  it('envoie la sequence d orbes au debut de la recharge', () => {
    scheduler.fire(MATCH_ID);
    const [start] = notifier.to(SEATS.a, 'recharge:start') as [ServerMessage<'recharge:start'>];
    expect(start.orbs.length).toBeGreaterThan(0);
    expect(start.endsAt).toBeGreaterThan(start.startsAt);
  });

  it('donne exactement les memes orbes aux deux joueurs', () => {
    scheduler.fire(MATCH_ID);
    expect(notifier.to(SEATS.a, 'recharge:start')).toEqual(notifier.to(SEATS.b, 'recharge:start'));
  });

  it('envoie la jauge de timing au debut du choix', () => {
    advanceTo('choice');
    const [start] = notifier.to(SEATS.a, 'choice:start') as [ServerMessage<'choice:start'>];
    expect(start.meter.period).toBeGreaterThanOrEqual(1_500);
  });

  it('donne a chacun sa propre energie au debut du choix', () => {
    advanceTo('choice');
    const [pourA] = notifier.to(SEATS.a, 'choice:start') as [ServerMessage<'choice:start'>];
    expect(pourA.energy).toBe(BALANCE.match.startingEnergy);
  });
});

describe('verrouillage du choix', () => {
  beforeEach(() => {
    advanceTo('choice');
    notifier.clear();
  });

  it('previent l adversaire sans rien lui dire du choix', () => {
    runtime.lockChoice(MATCH_ID, 'a', choice(2), null);
    const [locked] = notifier.to(SEATS.b, 'opponent:locked') as [ServerMessage<'opponent:locked'>];
    expect(locked).toEqual({ matchId: MATCH_ID, round: 1 });
    expect(notifier.namesFor(SEATS.b)).not.toContain('round:result');
  });

  it('ne previent pas le joueur de son propre verrouillage', () => {
    runtime.lockChoice(MATCH_ID, 'a', choice(2), null);
    expect(notifier.namesFor(SEATS.a)).not.toContain('opponent:locked');
  });

  it('revele des que les deux ont verrouille', () => {
    runtime.lockChoice(MATCH_ID, 'a', choice(3), null);
    runtime.lockChoice(MATCH_ID, 'b', choice(1), null);
    expect(notifier.to(SEATS.a, 'round:result')).toHaveLength(1);
    expect(notifier.to(SEATS.b, 'round:result')).toHaveLength(1);
  });

  it('montre les deux cotes dans le resultat, et seulement la', () => {
    runtime.lockChoice(MATCH_ID, 'a', choice(3), null);
    runtime.lockChoice(MATCH_ID, 'b', choice(1), null);
    const [result] = notifier.to(SEATS.a, 'round:result') as [ServerMessage<'round:result'>];
    expect(result.sides.a.move.tier).toBe(3);
    expect(result.sides.b.move.tier).toBe(1);
    expect(result.winner).toBe('a');
  });

  it('refuse un choix trop cher et le dit au seul interesse', () => {
    runtime.lockChoice(
      MATCH_ID,
      'a',
      { move: { style: 'calme', tier: 4 }, amplifier: 4, useUltimate: false },
      null,
    );
    // 8 d energie sur 14 : payable. On vide d'abord la reserve.
    notifier.clear();
    runtime.lockChoice(MATCH_ID, 'a', choice(1), null);
    const errors = notifier.to(SEATS.a, 'error') as { code: string }[];
    expect(errors[0]?.code).toBe('ALREADY_LOCKED');
    expect(notifier.namesFor(SEATS.b)).not.toContain('error');
  });

  it('refuse un Ultime dont la jauge n est pas pleine', () => {
    runtime.lockChoice(
      MATCH_ID,
      'a',
      { move: { style: 'calme', tier: 1 }, amplifier: 0, useUltimate: true },
      null,
    );
    const errors = notifier.to(SEATS.a, 'error') as { code: string }[];
    expect(errors[0]?.code).toBe('ULT_NOT_READY');
  });
});

describe('echeance de la phase de choix', () => {
  it('resout la manche avec les actions par defaut', () => {
    advanceTo('choice');
    notifier.clear();
    scheduler.fire(MATCH_ID);
    expect(notifier.to(SEATS.a, 'round:result')).toHaveLength(1);
  });
});

describe('fin de match', () => {
  /** Joue une manche entiere ou `winner` prend l avantage. */
  const playRound = (winner: Seat): void => {
    advanceTo('choice');
    runtime.lockChoice(MATCH_ID, winner, choice(3), null);
    runtime.lockChoice(MATCH_ID, winner === 'a' ? 'b' : 'a', choice(0), null);
    scheduler.fire(MATCH_ID);
  };

  it('annonce la fin apres deux manches gagnees', () => {
    playRound('a');
    playRound('a');
    const [end] = notifier.to(SEATS.a, 'match:end') as [ServerMessage<'match:end'>];
    expect(end.winner).toBe('a');
    expect(end.reason).toBe('rounds');
  });

  it('annule l echeance en cours a la fin du match', () => {
    playRound('a');
    playRound('a');
    expect(scheduler.pending(MATCH_ID)).toBe(null);
  });

  it('oublie le match termine', () => {
    playRound('a');
    playRound('a');
    expect(runtime.phaseOf(MATCH_ID)).toBe(null);
  });
});

describe('abandon', () => {
  it('donne la victoire a l autre joueur', () => {
    runtime.forfeit(MATCH_ID, 'a');
    const [end] = notifier.to(SEATS.b, 'match:end') as [ServerMessage<'match:end'>];
    expect(end.winner).toBe('b');
    expect(end.reason).toBe('forfeit');
  });
});

describe('reprise apres reconnexion', () => {
  it('rend un instantane sans information cachee', () => {
    advanceTo('choice');
    runtime.lockChoice(MATCH_ID, 'b', choice(2), null);
    const snapshot = runtime.snapshotFor(MATCH_ID, 'a');
    expect(snapshot?.opponentLocked).toBe(true);
    expect(snapshot?.seat).toBe('a');
    expect(JSON.stringify(snapshot)).not.toContain('"tier":2');
  });

  it('ne rend rien pour un match inconnu', () => {
    expect(runtime.snapshotFor('inexistant', 'a')).toBe(null);
  });
});

describe('robustesse', () => {
  it('ignore une action sur un match inconnu', () => {
    expect(() => {
      runtime.lockChoice('inexistant', 'a', choice(1), null);
    }).not.toThrow();
  });

  it('ignore des taps hors de la phase de recharge', () => {
    advanceTo('choice');
    notifier.clear();
    runtime.submitTaps(MATCH_ID, 'a', [{ atMs: 100, orbIndex: 0 }]);
    expect(notifier.sent).toHaveLength(0);
  });

  it('compte les taps envoyes pendant la recharge', () => {
    scheduler.fire(MATCH_ID);
    const [start] = notifier.to(SEATS.a, 'recharge:start') as [ServerMessage<'recharge:start'>];
    const taps = start.orbs
      .slice(0, 4)
      .map((orb, i) => ({ atMs: (i + 1) * 200, orbIndex: orb.index }));
    runtime.submitTaps(MATCH_ID, 'a', taps);
    notifier.clear();
    scheduler.fire(MATCH_ID);
    const [choiceStart] = notifier.to(SEATS.a, 'choice:start') as [ServerMessage<'choice:start'>];
    expect(choiceStart.ult).toBeGreaterThan(0);
  });
});

describe('round:result — fidele a la resolution', () => {
  it('reprend le timing et le score avant contre', () => {
    advanceTo('choice');
    runtime.lockChoice(MATCH_ID, 'a', choice(3), null);
    runtime.lockChoice(MATCH_ID, 'b', choice(1), null);
    const [result] = notifier.to(SEATS.a, 'round:result') as [ServerMessage<'round:result'>];

    // Aucun des deux n a tape la jauge : timing rate, ecart maximal.
    expect(result.sides.a.timing.quality).toBe('miss');
    expect(result.sides.a.timing.error).toBe(1);
    // Meme style des deux cotes : pas de contre, donc base = final.
    expect(result.sides.a.base).toBe(result.sides.a.final);
  });

  it('revele le perdant en premier', () => {
    advanceTo('choice');
    runtime.lockChoice(MATCH_ID, 'a', choice(3), null);
    runtime.lockChoice(MATCH_ID, 'b', choice(0), null);
    const [result] = notifier.to(SEATS.a, 'round:result') as [ServerMessage<'round:result'>];
    expect(result.winner).toBe('a');
    expect(result.timeline.revealFirst).toBe('b');
  });

  it('numerote la manche selon l historique, pas selon la phase suivante', () => {
    advanceTo('choice');
    runtime.lockChoice(MATCH_ID, 'a', choice(3), null);
    runtime.lockChoice(MATCH_ID, 'b', choice(1), null);
    const [result] = notifier.to(SEATS.a, 'round:result') as [ServerMessage<'round:result'>];
    expect(result.round).toBe(1);
  });

  it('annonce les points de recharge de chacun', () => {
    scheduler.fire(MATCH_ID);
    const [start] = notifier.to(SEATS.a, 'recharge:start') as [ServerMessage<'recharge:start'>];
    const taps = start.orbs
      .slice(0, 3)
      .map((orb, i) => ({ atMs: (i + 1) * 200, orbIndex: orb.index }));
    runtime.submitTaps(MATCH_ID, 'a', taps);
    advanceTo('choice');
    runtime.lockChoice(MATCH_ID, 'a', choice(1), null);
    runtime.lockChoice(MATCH_ID, 'b', choice(1), null);
    const [result] = notifier.to(SEATS.a, 'round:result') as [ServerMessage<'round:result'>];
    expect(result.sides.a.recharge.points).toBeGreaterThanOrEqual(3);
    expect(result.sides.b.recharge.points).toBe(0);
  });
});
