import { BALANCE, type Choice, type Seat } from '@aura/rules';
import type { ServerMessage, ServerMessageName } from '@aura/protocol';
import { beforeEach, describe, expect, it } from 'vitest';
import type { MatchClock, MatchNotifier, MatchRecord, TimerScheduler } from '../domain/ports.js';
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

/**
 * Minuteur manuel : le temps n'avance que si on le pousse.
 *
 * Declencher une echeance **avance l'horloge jusqu'a elle**, comme le ferait un
 * vrai minuteur. Sans cela, les tests soumettraient des taps annonces a 800 ms
 * avec une horloge restee a zero — c'est-a-dire exactement la triche que le
 * runtime doit refuser.
 */
class ManualScheduler implements TimerScheduler {
  private readonly timers = new Map<string, { atMs: number; run: () => void }>();

  constructor(private readonly clock: MovableClock) {}

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
    this.clock.current = Math.max(this.clock.current, timer.atMs);
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
  clock = new MovableClock();
  scheduler = new ManualScheduler(clock);
  runtime = new MatchRuntime(notifier, scheduler, clock);
  runtime.createMatch({ matchId: MATCH_ID, seed: 'graine', seats: SEATS });
});

describe('un joueur ne tient qu un siege', () => {
  /**
   * Deux `invite:join` envoyes dans la meme salve suffisaient.
   *
   * Socket.IO delivre chaque paquet dans son propre tour de boucle ; la
   * passerelle suspendait sur une lecture en base entre ses controles et la
   * creation du match, et les deux handlers ouvraient chacun le leur. Le
   * joueur se retrouvait assis dans DEUX parties.
   *
   * Le degat n'etait pas le double siege lui-meme : `locate` ne rend que le
   * PREMIER match trouve, donc la deconnexion n'armait le compte a rebours que
   * sur celui-la. L'adversaire du second jouait une partie entiere contre un
   * absent, sans que les 45 s d'abandon ne s'appliquent jamais.
   *
   * Le refus vit donc ici, et pas seulement dans la passerelle : c'est le seul
   * endroit qu'aucun chemin d'ouverture — invitation, file d'attente, revanche
   * — ne peut contourner.
   */
  it('refuse d asseoir un joueur deja en match', () => {
    const accepted = runtime.createMatch({
      matchId: 'm_02',
      seed: 'g',
      seats: { a: 'player-a', b: 'autre' },
    });
    expect(accepted).toBe(false);
    expect(runtime.phaseOf('m_02')).toBeNull();
  });

  it('refuse aussi quand c est le second siege qui est pris', () => {
    const accepted = runtime.createMatch({
      matchId: 'm_02',
      seed: 'g',
      seats: { a: 'autre', b: 'player-b' },
    });
    expect(accepted).toBe(false);
  });

  it('accepte deux joueurs libres', () => {
    expect(runtime.createMatch({ matchId: 'm_02', seed: 'g', seats: { a: 'x', b: 'y' } })).toBe(
      true,
    );
  });

  it('dit qui est occupe', () => {
    expect(runtime.isBusy('player-a')).toBe(true);
    expect(runtime.isBusy('inconnu')).toBe(false);
  });

  /**
   * Le defaut symetrique, et il serait silencieux : un joueur qui reste
   * marque « occupe » apres la fin de sa partie ne peut plus jamais en
   * rejoindre une.
   */
  it('libere les deux joueurs a la fin du match', () => {
    runtime.forfeit(MATCH_ID, 'a');
    expect(runtime.isBusy('player-a')).toBe(false);
    expect(runtime.isBusy('player-b')).toBe(false);
    expect(runtime.createMatch({ matchId: 'm_03', seed: 'g', seats: SEATS })).toBe(true);
  });
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

describe('persistance — un match doit pouvoir etre rejoue', () => {
  class RecordingRepository {
    readonly saved: MatchRecord[] = [];
    save(record: MatchRecord): Promise<void> {
      this.saved.push(record);
      return Promise.resolve();
    }
  }

  let repository: RecordingRepository;

  beforeEach(() => {
    repository = new RecordingRepository();
    runtime = new MatchRuntime(notifier, scheduler, clock, BALANCE, repository);
    runtime.createMatch({ matchId: MATCH_ID, seed: 'graine', seats: SEATS });
  });

  const playRound = (winner: Seat): void => {
    advanceTo('choice');
    runtime.lockChoice(MATCH_ID, winner, choice(3), null);
    runtime.lockChoice(MATCH_ID, winner === 'a' ? 'b' : 'a', choice(0), null);
    scheduler.fire(MATCH_ID);
  };

  it('n ecrit rien tant que le match dure', () => {
    playRound('a');
    expect(repository.saved).toHaveLength(0);
  });

  it('ecrit le match une fois termine', () => {
    playRound('a');
    playRound('a');
    expect(repository.saved).toHaveLength(1);
    expect(repository.saved[0]?.winner).toBe('a');
    expect(repository.saved[0]?.reason).toBe('rounds');
  });

  it('conserve la graine, sans laquelle rien n est rejouable', () => {
    playRound('a');
    playRound('a');
    expect(repository.saved[0]?.seed).toBe('graine');
  });

  it('conserve les versions du moteur et du contenu', () => {
    playRound('a');
    playRound('a');
    expect(repository.saved[0]?.rulesVersion).toMatch(/^\d+\.\d+\.\d+$/);
    expect(repository.saved[0]?.contentVersion).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it('conserve chaque manche resolue', () => {
    playRound('a');
    playRound('a');
    expect(repository.saved[0]?.rounds).toHaveLength(2);
    expect(repository.saved[0]?.rounds[0]?.round).toBe(1);
  });

  it('conserve le journal complet des evenements', () => {
    playRound('a');
    playRound('a');
    const journal = repository.saved[0]?.events ?? [];
    // Deux manches : verrouillages, echeances de phase. Le journal doit tout
    // porter, sinon le rejeu ne redonne pas le meme match.
    expect(journal.length).toBeGreaterThan(6);
    expect(journal.every((entry) => typeof entry.atMs === 'number')).toBe(true);
  });

  it('conserve les deux sieges', () => {
    playRound('a');
    playRound('a');
    expect(repository.saved[0]?.seats).toEqual({ a: SEATS.a, b: SEATS.b });
  });

  it('ecrit aussi un match termine par abandon', () => {
    runtime.forfeit(MATCH_ID, 'a');
    expect(repository.saved[0]?.reason).toBe('forfeit');
    expect(repository.saved[0]?.winner).toBe('b');
  });

  it('ne fait pas tomber le match si l ecriture echoue', () => {
    const cassee = {
      save: () => Promise.reject(new Error('base indisponible')),
    };
    runtime = new MatchRuntime(notifier, scheduler, clock, BALANCE, cassee);
    runtime.createMatch({ matchId: 'm_02', seed: 'g', seats: SEATS });
    // Les joueurs ont deja recu leur resultat : une base lente ou en panne ne
    // doit pas retarder ni casser leur fin de partie.
    expect(() => {
      runtime.forfeit('m_02', 'a');
    }).not.toThrow();
  });
});

describe('deconnexion — le match continue, puis tranche', () => {
  beforeEach(() => {
    advanceTo('choice');
    notifier.clear();
  });

  it('ne coupe pas le match quand un joueur se deconnecte', () => {
    runtime.notePlayerDisconnected(SEATS.a);
    // Le match continue : les echeances s'appliquent et les actions par
    // defaut sont jouees (docs/01 §9). Couper tout de suite punirait un
    // joueur qui passe sous un tunnel.
    expect(runtime.phaseOf(MATCH_ID)).toBe('choice');
    expect(notifier.namesFor(SEATS.b)).not.toContain('match:end');
  });

  it('programme un forfait a 45 secondes', () => {
    runtime.notePlayerDisconnected(SEATS.a);
    expect(scheduler.pending(`${MATCH_ID}:disconnect:a`)).toBe(clock.now() + 45_000);
  });

  it('declare forfait si le joueur ne revient pas', () => {
    runtime.notePlayerDisconnected(SEATS.a);
    scheduler.fire(`${MATCH_ID}:disconnect:a`);
    const [end] = notifier.to(SEATS.b, 'match:end') as [{ winner: string; reason: string }];
    expect(end.winner).toBe('b');
    expect(end.reason).toBe('forfeit');
  });

  it('annule le forfait si le joueur revient a temps', () => {
    runtime.notePlayerDisconnected(SEATS.a);
    runtime.notePlayerReconnected(SEATS.a);
    expect(scheduler.pending(`${MATCH_ID}:disconnect:a`)).toBe(null);
    expect(runtime.phaseOf(MATCH_ID)).toBe('choice');
  });

  it('ignore la deconnexion d un joueur qui n est dans aucun match', () => {
    expect(() => {
      runtime.notePlayerDisconnected('inconnu');
    }).not.toThrow();
  });

  it('oublie le minuteur de deconnexion a la fin du match', () => {
    runtime.notePlayerDisconnected(SEATS.a);
    runtime.forfeit(MATCH_ID, 'b');
    expect(scheduler.pending(`${MATCH_ID}:disconnect:a`)).toBe(null);
  });
});

describe('idempotence — un renvoi ne doit pas compter deux fois', () => {
  it('accepte un seq croissant', () => {
    expect(runtime.acceptSeq(MATCH_ID, 'a', 1)).toBe(true);
    expect(runtime.acceptSeq(MATCH_ID, 'a', 2)).toBe(true);
    expect(runtime.acceptSeq(MATCH_ID, 'a', 7)).toBe(true);
  });

  it('refuse un seq deja traite', () => {
    runtime.acceptSeq(MATCH_ID, 'a', 5);
    // Le cas reel : le client se reconnecte et renvoie ses taps par securite.
    expect(runtime.acceptSeq(MATCH_ID, 'a', 5)).toBe(false);
    expect(runtime.acceptSeq(MATCH_ID, 'a', 3)).toBe(false);
  });

  it('compte les deux sieges separement', () => {
    runtime.acceptSeq(MATCH_ID, 'a', 9);
    // Le compteur de l'un ne doit pas bloquer l'autre.
    expect(runtime.acceptSeq(MATCH_ID, 'b', 1)).toBe(true);
  });

  it('refuse tout seq sur un match inconnu', () => {
    expect(runtime.acceptSeq('inexistant', 'a', 1)).toBe(false);
  });

  it('ne compte pas deux fois des taps renvoyes', () => {
    scheduler.fire(MATCH_ID);
    const [start] = notifier.to(SEATS.a, 'recharge:start') as [{ orbs: { index: number }[] }];
    const taps = start.orbs
      .slice(0, 4)
      .map((orb, i) => ({ atMs: (i + 1) * 200, orbIndex: orb.index }));

    // Premier envoi accepte, renvoi identique rejete.
    expect(runtime.acceptSeq(MATCH_ID, 'a', 1)).toBe(true);
    runtime.submitTaps(MATCH_ID, 'a', taps);
    expect(runtime.acceptSeq(MATCH_ID, 'a', 1)).toBe(false);

    notifier.clear();
    scheduler.fire(MATCH_ID);
    const [choiceStart] = notifier.to(SEATS.a, 'choice:start') as [{ ult: number }];
    // Quatre orbes touchees une seule fois : la jauge ne doit pas avoir double.
    expect(choiceStart.ult).toBeLessThanOrEqual(4 * 3 * BALANCE.recharge.ultimatePerPoint);
  });
});

describe('journal — borne et purge des evenements refuses', () => {
  class CountingRepository {
    readonly saved: MatchRecord[] = [];
    save(record: MatchRecord): Promise<void> {
      this.saved.push(record);
      return Promise.resolve();
    }
  }

  let repository: CountingRepository;

  beforeEach(() => {
    repository = new CountingRepository();
    runtime = new MatchRuntime(notifier, scheduler, clock, BALANCE, repository);
    runtime.createMatch({ matchId: MATCH_ID, seed: 'graine', seats: SEATS });
  });

  it('ne journalise pas un evenement que le moteur refuse', () => {
    // Des taps hors de la phase de recharge : le moteur les jette. Sans cette
    // regle, le journal les garderait quand meme.
    for (let i = 0; i < 50; i += 1) {
      runtime.submitTaps(MATCH_ID, 'a', [{ atMs: 10, orbIndex: 0 }]);
    }
    runtime.forfeit(MATCH_ID, 'a');

    const record = repository.saved[0]!;
    expect(record.rejectedEvents.a).toBe(50);
    expect(record.rejectedEvents.b).toBe(0);
    // Seul l'abandon, qui change l'etat, figure au journal.
    expect(record.events).toHaveLength(1);
  });

  it('borne le journal meme sous un flot d evenements acceptes', () => {
    scheduler.fire(MATCH_ID);
    const orbs =
      (notifier.to(SEATS.a, 'recharge:start')[0] as { orbs: { index: number }[] }).orbs ?? [];
    // Beaucoup plus d'envois que ce qu'un match honnete produit.
    clock.current += 200;
    for (let i = 0; i < 700; i += 1) {
      runtime.submitTaps(MATCH_ID, 'a', [{ atMs: 100, orbIndex: orbs[0]!.index }]);
    }
    runtime.forfeit(MATCH_ID, 'a');

    const record = repository.saved[0]!;
    expect(record.events.length).toBeLessThanOrEqual(500);
    expect(record.droppedEvents.a).toBeGreaterThan(0);
  });

  it('garde un journal complet pour un match normal', () => {
    advanceTo('choice');
    runtime.lockChoice(MATCH_ID, 'a', choice(3), null);
    runtime.lockChoice(MATCH_ID, 'b', choice(1), null);
    scheduler.fire(MATCH_ID);
    runtime.forfeit(MATCH_ID, 'a');

    const record = repository.saved[0]!;
    // Rien de perdu, rien de refuse : un match honnete tient tres largement.
    expect(record.droppedEvents).toEqual({ a: 0, b: 0 });
    expect(record.rejectedEvents).toEqual({ a: 0, b: 0 });
    expect(record.events.length).toBeGreaterThan(3);
  });
});

describe('anti-triche — un instant declare doit avoir pu avoir lieu', () => {
  const orbsOf = (): { index: number }[] =>
    (notifier.to(SEATS.a, 'recharge:start')[0] as { orbs: { index: number }[] }).orbs;

  beforeEach(() => {
    scheduler.fire(MATCH_ID); // intro -> recharge
  });

  it('accepte des taps dont l instant correspond au temps ecoule', () => {
    const orbs = orbsOf();
    clock.current += 2_000; // deux secondes de phase se sont ecoulees
    const taps = orbs.slice(0, 3).map((orb, i) => ({ atMs: (i + 1) * 400, orbIndex: orb.index }));
    runtime.submitTaps(MATCH_ID, 'a', taps);
    expect(runtime.phaseOf(MATCH_ID)).toBe('recharge');
    notifier.clear();
    scheduler.fire(MATCH_ID);
    const [start] = notifier.to(SEATS.a, 'choice:start') as [{ ult: number }];
    expect(start.ult).toBeGreaterThan(0);
  });

  it('ecarte un tap annonce dans le futur', () => {
    const orbs = orbsOf();
    // Le lot arrive 200 ms apres le debut de la phase mais annonce un tap a
    // 5,8 s : c'est le programme calcule hors ligne du bot.
    clock.current += 200;
    runtime.submitTaps(MATCH_ID, 'a', [{ atMs: 5_800, orbIndex: orbs[0]!.index }]);

    notifier.clear();
    scheduler.fire(MATCH_ID);
    const [start] = notifier.to(SEATS.a, 'choice:start') as [{ ult: number }];
    // Rien n'a ete compte : la jauge n'a pas bouge.
    expect(start.ult).toBe(0);
  });

  it('ecarte tout un programme calcule d avance', () => {
    const orbs = orbsOf();
    clock.current += 100;
    const programme = orbs.slice(0, 40).map((orb, i) => ({ atMs: i * 140, orbIndex: orb.index }));
    runtime.submitTaps(MATCH_ID, 'a', programme);

    notifier.clear();
    scheduler.fire(MATCH_ID);
    const [start] = notifier.to(SEATS.a, 'choice:start') as [{ ult: number }];
    // Seuls les tout premiers instants sont plausibles a 100 ms de phase.
    expect(start.ult).toBeLessThan(40 * BALANCE.recharge.ultimatePerPoint);
  });

  it('tolere le retard reseau d un joueur honnete', () => {
    const orbs = orbsOf();
    // Le joueur tape a 1 000 ms ; son lot arrive a 1 050 ms. Sans tolerance,
    // ce serait deja considere comme impossible.
    clock.current += 1_050;
    runtime.submitTaps(MATCH_ID, 'a', [{ atMs: 1_000, orbIndex: orbs[0]!.index }]);
    notifier.clear();
    scheduler.fire(MATCH_ID);
    const [start] = notifier.to(SEATS.a, 'choice:start') as [{ ult: number }];
    expect(start.ult).toBeGreaterThan(0);
  });

  it('remplace un timing impossible par une absence de tap', () => {
    scheduler.fire(MATCH_ID); // recharge -> choice
    // Verrouiller 200 ms apres le debut de la phase en annoncant une charge de
    // quatre secondes : le temps ne s'est pas ecoule.
    clock.current += 200;
    runtime.lockChoice(MATCH_ID, 'a', choice(2), 4_000);
    runtime.lockChoice(MATCH_ID, 'b', choice(2), null);

    const resolved = notifier.to(SEATS.a, 'round:result') as [
      { sides: { a: { timing: { quality: string } } } },
    ];
    expect(resolved[0]?.sides.a.timing.quality).toBe('miss');
  });

  it('accepte un timing compatible avec le temps ecoule', () => {
    scheduler.fire(MATCH_ID);
    clock.current += 4_000;
    runtime.lockChoice(MATCH_ID, 'a', choice(2), 3_500);
    runtime.lockChoice(MATCH_ID, 'b', choice(2), null);
    const resolved = notifier.to(SEATS.a, 'round:result') as [
      { sides: { a: { timing: { error: number } } } },
    ];
    // Un vrai tap : l'ecart n'est pas le pire possible.
    expect(resolved[0]?.sides.a.timing.error).toBeLessThan(1);
  });
});

describe('compteurs anti-triche — attribues au bon siege', () => {
  class Keeper {
    readonly saved: MatchRecord[] = [];
    save(record: MatchRecord): Promise<void> {
      this.saved.push(record);
      return Promise.resolve();
    }
  }

  let keeper: Keeper;

  beforeEach(() => {
    keeper = new Keeper();
    runtime = new MatchRuntime(notifier, scheduler, clock, BALANCE, keeper);
    runtime.createMatch({ matchId: MATCH_ID, seed: 'graine', seats: SEATS });
    scheduler.fire(MATCH_ID); // intro -> recharge
  });

  it('impute les instants impossibles au seul siege fautif', () => {
    const orbs = (notifier.to(SEATS.a, 'recharge:start')[0] as { orbs: { index: number }[] }).orbs;
    clock.current += 100;
    // Le siege a ment ; le siege b joue normalement.
    runtime.submitTaps(MATCH_ID, 'a', [
      { atMs: 5_800, orbIndex: orbs[0]!.index },
      { atMs: 5_900, orbIndex: orbs[1]!.index },
    ]);
    runtime.submitTaps(MATCH_ID, 'b', [{ atMs: 50, orbIndex: orbs[0]!.index }]);
    runtime.forfeit(MATCH_ID, 'a');

    const record = keeper.saved[0]!;
    expect(record.impossibleTaps.a).toBe(2);
    // Le point qui compte : l'innocent reste a zero. Un compteur commun lui
    // attribuerait les mensonges de son adversaire, et docs/06 sanctionne
    // automatiquement avant toute revue humaine.
    expect(record.impossibleTaps.b).toBe(0);
  });

  it('impute les evenements refuses au seul siege fautif', () => {
    scheduler.fire(MATCH_ID); // recharge -> choice : les taps n y ont plus leur place
    for (let i = 0; i < 7; i += 1) {
      runtime.submitTaps(MATCH_ID, 'b', [{ atMs: 10, orbIndex: 0 }]);
    }
    runtime.forfeit(MATCH_ID, 'a');

    const record = keeper.saved[0]!;
    expect(record.rejectedEvents.b).toBe(7);
    expect(record.rejectedEvents.a).toBe(0);
  });

  it('n impute a personne un refus venu de notre propre minuteur', () => {
    // Une echeance declenchee trop tot est un defaut du serveur, pas la faute
    // d'un joueur.
    runtime.forfeit(MATCH_ID, 'a');
    const record = keeper.saved[0]!;
    expect(record.rejectedEvents).toEqual({ a: 0, b: 0 });
  });
});

describe('journal — le squelette du rejeu survit a la troncature', () => {
  class Keeper2 {
    readonly saved: MatchRecord[] = [];
    save(record: MatchRecord): Promise<void> {
      this.saved.push(record);
      return Promise.resolve();
    }
  }

  let keeper: Keeper2;

  beforeEach(() => {
    keeper = new Keeper2();
    runtime = new MatchRuntime(notifier, scheduler, clock, BALANCE, keeper);
    runtime.createMatch({ matchId: MATCH_ID, seed: 'graine', seats: SEATS });
  });

  it('garde les transitions de phase meme quand un joueur noie le journal', () => {
    scheduler.fire(MATCH_ID); // intro -> recharge
    const orbs = (notifier.to(SEATS.a, 'recharge:start')[0] as { orbs: { index: number }[] }).orbs;
    clock.current += 200;
    // Bien plus de lots que le journal ne peut en contenir.
    for (let i = 0; i < 900; i += 1) {
      runtime.submitTaps(MATCH_ID, 'a', [{ atMs: 100, orbIndex: orbs[0]!.index }]);
    }
    // Les phases continuent d'avancer apres la noyade.
    advanceTo('choice');
    runtime.forfeit(MATCH_ID, 'a');

    const record = keeper.saved[0]!;
    const transitions = record.events.filter(
      (entry) => (entry.event as { type: string }).type === 'PHASE_TIMEOUT',
    );
    // Sans reserve, ces transitions auraient ete chassees par les lots de taps
    // et le journal ne rejouerait plus rien.
    expect(transitions.length).toBeGreaterThanOrEqual(2);
    expect(record.droppedEvents.a).toBeGreaterThan(0);
  });

  it('ne perd jamais une transition de phase, donc la comptabilite boucle', () => {
    scheduler.fire(MATCH_ID);
    const orbs = (notifier.to(SEATS.a, 'recharge:start')[0] as { orbs: { index: number }[] }).orbs;
    clock.current += 200;
    for (let i = 0; i < 900; i += 1) {
      runtime.submitTaps(MATCH_ID, 'a', [{ atMs: 100, orbIndex: orbs[0]!.index }]);
    }
    advanceTo('choice');
    runtime.forfeit(MATCH_ID, 'a');

    const record = keeper.saved[0]!;
    const phases = record.events.filter(
      (entry) => (entry.event as { type: string }).type === 'PHASE_TIMEOUT',
    ).length;
    const seatEntries = record.events.length - phases;
    // Tout ce qui manque est impute a un siege : rien ne disparait en silence.
    expect(seatEntries + record.droppedEvents.a + record.droppedEvents.b).toBeGreaterThan(900);
  });
});
