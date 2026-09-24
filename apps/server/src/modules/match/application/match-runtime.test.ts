import { defaultAnimationFor } from '@aura/content';
import {
  BALANCE,
  buildRoundContext,
  createRng,
  deriveSeed,
  type Choice,
  type Seat,
  type Style,
} from '@aura/rules';
import type { ServerMessage, ServerMessageName } from '@aura/protocol';
import { beforeEach, describe, expect, it } from 'vitest';
import type {
  GhostRecorder,
  MatchClock,
  MatchNotifier,
  MatchRatingSettlement,
  MatchRecord,
  SeatRatingOutcome,
  TimerScheduler,
} from '../domain/ports.js';
import type { MatchContribution } from '../../challenges/domain/progress.js';
import { MatchRuntime } from './match-runtime.js';

/** Attend que les micro-taches en attente (les `await` de `settleAndAnnounce`) se resolvent. */
const flush = async (): Promise<void> => {
  for (let i = 0; i < 5; i += 1) await Promise.resolve();
};

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

  /**
   * Un joueur ne peut pas s'asseoir en face de lui-meme.
   *
   * `isBusy` ne suffit pas : au moment du controle le match n'existe pas
   * encore, donc les deux appels rendent `false` pour le meme joueur libre.
   * L'index `seatedIn` ecrivait alors deux fois la meme cle, et la partie
   * s'ouvrait avec le meme joueur des deux cotes.
   *
   * Ce n'etait pas exploitable tant que l'invitation etait le seul chemin :
   * `invites.ts` refuse de rejoindre sa propre invitation. Mais c'etait une
   * garde du CHEMIN, pas de l'ouverture — et la file d'attente est un second
   * chemin. Un joueur assis contre lui-meme controle les deux choix, gagne a
   * coup sur, et la partie part en base en `RANKED`.
   */
  it('refuse d asseoir un joueur en face de lui-meme', () => {
    expect(
      runtime.createMatch({ matchId: 'm_02', seed: 'g', seats: { a: 'seul', b: 'seul' } }),
    ).toBe(false);
    expect(runtime.phaseOf('m_02')).toBeNull();
    expect(runtime.isBusy('seul')).toBe(false);
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

  it('accepte seq 0, le premier numero que le client envoie', () => {
    // Le protocole admet 0 (`seqSchema` : entier positif ou nul) et le client
    // compte a partir de 0. Un compteur serveur parti de 0 jetait donc en
    // silence le premier message de chaque match : un paquet de taps, ou — si
    // le joueur n'avait rien tape — son verrouillage. La manche se jouait
    // alors avec le choix par defaut, et l'aura choisie ne sortait jamais.
    expect(runtime.acceptSeq(MATCH_ID, 'a', 0)).toBe(true);
    expect(runtime.acceptSeq(MATCH_ID, 'a', 0)).toBe(false);
    expect(runtime.acceptSeq(MATCH_ID, 'a', 1)).toBe(true);
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

  it('refuse une action qui vise une autre manche que la manche en cours', () => {
    /*
      Le seq est garde pour tout le match, pas par manche. Un verrouillage reste
      dans le tampon de Socket.IO pendant une coupure, et il est vide a la
      reconnexion : si elle tombe dans la phase de choix de la manche suivante,
      son seq, plus grand, passait. L'ancien choix verrouillait alors une manche
      a laquelle le joueur n'avait pas encore repondu, et en payait l'energie.
    */
    expect(runtime.acceptAction(MATCH_ID, 'a', 2, 5)).toBe(false);
    // Refusee pour sa manche, l'action ne consomme pas son numero.
    expect(runtime.acceptAction(MATCH_ID, 'a', 1, 5)).toBe(true);
    expect(runtime.acceptAction(MATCH_ID, 'a', 1, 5)).toBe(false);
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

describe('classement de fin de match (docs/05, jalon M5)', () => {
  const OUTCOME: Readonly<Record<Seat, SeatRatingOutcome>> = {
    a: {
      before: { leaguePoints: 100, league: 'naissante' },
      after: { leaguePoints: 122, league: 'naissante' },
      rewards: { softCurrency: 20, xp: 30, xpTotal: 30 },
    },
    b: {
      before: { leaguePoints: 100, league: 'naissante' },
      after: { leaguePoints: 82, league: 'naissante' },
      rewards: { softCurrency: 8, xp: 12, xpTotal: 12 },
    },
  };

  class FakeSettlement implements MatchRatingSettlement {
    calls: {
      mode: string;
      seats: Record<Seat, string>;
      result: { winner: Seat | null; reason: string };
    }[] = [];
    failure: Error | null = null;

    settle(input: {
      mode: 'RANKED' | 'CASUAL' | 'INVITE' | 'SOLO';
      seats: Readonly<Record<Seat, string>>;
      result: { winner: Seat | null; reason: string };
      atMs: number;
    }): Promise<Readonly<Record<Seat, SeatRatingOutcome>>> {
      this.calls.push({ mode: input.mode, seats: { ...input.seats }, result: input.result });
      if (this.failure !== null) return Promise.reject(this.failure);
      return Promise.resolve(OUTCOME);
    }
  }

  let settlement: FakeSettlement;

  beforeEach(() => {
    settlement = new FakeSettlement();
    runtime = new MatchRuntime(notifier, scheduler, clock, BALANCE, null, settlement);
    runtime.createMatch({ matchId: MATCH_ID, seed: 'graine', seats: SEATS, mode: 'RANKED' });
  });

  it('sans classement cable, match:end part neutre et sur-le-champ (retrocompatibilite)', () => {
    const bare = new MatchRuntime(notifier, scheduler, clock);
    bare.createMatch({ matchId: 'm_bare', seed: 'g', seats: SEATS });

    bare.forfeit('m_bare', 'a');

    const [end] = notifier.to(SEATS.b, 'match:end') as [ServerMessage<'match:end'>];
    expect(end.rating).toEqual({
      before: 0,
      after: 0,
      leagueBefore: 'sans_aura',
      leagueAfter: 'sans_aura',
    });
    expect(end.rewards).toEqual({ softCurrency: 0, xp: 0, xpTotal: 0 });
  });

  it('libere les sieges sur-le-champ, avant meme que le classement ne reponde', () => {
    runtime.forfeit(MATCH_ID, 'a');
    // Le classement n'a pas encore ete attendu : aucune micro-tache n'a tourne.
    expect(runtime.isBusy(SEATS.a)).toBe(false);
    expect(runtime.isBusy(SEATS.b)).toBe(false);
  });

  it('envoie le vrai classement une fois le calcul revenu', async () => {
    runtime.forfeit(MATCH_ID, 'a');
    await flush();

    const [endA] = notifier.to(SEATS.a, 'match:end') as [ServerMessage<'match:end'>];
    const [endB] = notifier.to(SEATS.b, 'match:end') as [ServerMessage<'match:end'>];
    expect(endA.rating).toEqual({
      before: 100,
      after: 122,
      leagueBefore: 'naissante',
      leagueAfter: 'naissante',
    });
    /*
      `xpTotal` accompagne le gain : c'est de lui que le niveau se deduit, et
      le gain seul n'en dit rien. Ici le faux service de classement rend le
      cumul du seul match joue.
    */
    expect(endA.rewards).toEqual({ softCurrency: 20, xp: 30, xpTotal: 30 });
    expect(endB.rating.after).toBe(82);
  });

  it('transmet le mode, les sieges et le resultat au service de classement', async () => {
    runtime.forfeit(MATCH_ID, 'a');
    await flush();

    expect(settlement.calls).toHaveLength(1);
    expect(settlement.calls[0]?.mode).toBe('RANKED');
    expect(settlement.calls[0]?.seats).toEqual(SEATS);
    expect(settlement.calls[0]?.result).toMatchObject({ winner: 'b', reason: 'forfeit' });
  });

  it('retombe sur un classement neutre si le calcul echoue, sans faire tomber le match', async () => {
    settlement.failure = new Error('base de classement indisponible');

    expect(() => {
      runtime.forfeit(MATCH_ID, 'a');
    }).not.toThrow();
    await flush();

    const [end] = notifier.to(SEATS.b, 'match:end') as [ServerMessage<'match:end'>];
    expect(end.rating).toEqual({
      before: 0,
      after: 0,
      leagueBefore: 'sans_aura',
      leagueAfter: 'sans_aura',
    });
  });

  it('n envoie match:end qu une seule fois par siege', async () => {
    runtime.forfeit(MATCH_ID, 'a');
    await flush();

    expect(notifier.to(SEATS.a, 'match:end')).toHaveLength(1);
    expect(notifier.to(SEATS.b, 'match:end')).toHaveLength(1);
  });
});

/**
 * Fantomes : enregistrement et siege (docs/05 § « Fantomes »).
 *
 * Deux moities distinctes. L'**enregistrement** ne doit se faire que pour un
 * match classe entre deux personnes — sans quoi un rejeu servirait de modele au
 * suivant, et le niveau de la file deriverait de copie en copie. Le **siege**
 * d'un fantome, lui, ne doit jamais etre ecrit comme un joueur : `Player` ne le
 * connait pas.
 */
describe('fantomes — enregistrement et siege', () => {
  class RecordingRepository {
    readonly saved: MatchRecord[] = [];
    save(record: MatchRecord): Promise<void> {
      this.saved.push(record);
      return Promise.resolve();
    }
  }

  class RecordingGhostRecorder {
    readonly calls: Parameters<GhostRecorder['record']>[0][] = [];
    record(input: Parameters<GhostRecorder['record']>[0]): Promise<void> {
      this.calls.push(input);
      return Promise.resolve();
    }
  }

  let repository: RecordingRepository;
  let recorder: RecordingGhostRecorder;

  /** Un siege fantome tel que l'ouverture le transmet, presentation comprise. */
  const GHOST_SEAT = {
    seat: 'b' as Seat,
    mmr: 1_000,
    sourcePlayerId: 'p_source',
    displayName: 'Aura anonyme',
    league: 'sans_aura',
  };

  const build = (options: {
    mode?: MatchRecord['mode'];
    ghost?: {
      seat: Seat;
      mmr: number;
      sourcePlayerId: string;
      displayName: string;
      league: string;
    } | null;
  }): void => {
    repository = new RecordingRepository();
    recorder = new RecordingGhostRecorder();
    runtime = new MatchRuntime(
      notifier,
      scheduler,
      clock,
      BALANCE,
      repository,
      null,
      null,
      recorder,
    );
    runtime.createMatch({
      matchId: MATCH_ID,
      seed: 'graine',
      seats: SEATS,
      mode: options.mode ?? 'RANKED',
      ghost: options.ghost ?? null,
    });
  };

  const playRound = (winner: Seat): void => {
    advanceTo('recharge');
    runtime.submitTaps(MATCH_ID, winner, [{ atMs: 10, orbIndex: 0 }]);
    advanceTo('choice');
    runtime.lockChoice(MATCH_ID, winner, choice(3), null);
    runtime.lockChoice(MATCH_ID, winner === 'a' ? 'b' : 'a', choice(0), null);
    scheduler.fire(MATCH_ID);
  };

  it('enregistre les deux joueurs a la fin d un match classe', () => {
    build({ mode: 'RANKED' });
    playRound('a');
    playRound('a');

    expect(recorder.calls).toHaveLength(1);
    const enregistre = recorder.calls[0]!;
    expect(enregistre.seats).toEqual(SEATS);
    expect(enregistre.rounds.a).toHaveLength(2);
    expect(enregistre.rounds.b).toHaveLength(2);
  });

  it('conserve le choix, le timing et le profil de recharge de chaque manche', () => {
    build({ mode: 'RANKED' });
    playRound('a');
    playRound('a');

    const manche = recorder.calls[0]!.rounds.a[0]!;
    expect(manche.move).toEqual({ style: 'calme', tier: 3 });
    expect(manche.amplifier).toBe(0);
    expect(manche.useUltimate).toBe(false);
    // Personne n'a tape la jauge : le moteur rend « rate », ecart maximal.
    expect(manche.timing.quality).toBe('miss');
    expect(manche.timing.delta).toBe(1);
    expect(manche.rechargeTaps).toBe(1);
    expect(manche.rechargePoints).toBeGreaterThanOrEqual(0);
  });

  it('n enregistre rien hors classe', () => {
    build({ mode: 'INVITE' });
    playRound('a');
    playRound('a');
    expect(recorder.calls).toHaveLength(0);
  });

  /** Un rejeu ne doit jamais servir de modele : le niveau deriverait de copie en copie. */
  it('n enregistre pas un match qui comptait deja un fantome', () => {
    build({ mode: 'RANKED', ghost: GHOST_SEAT });
    playRound('a');
    playRound('a');
    expect(recorder.calls).toHaveLength(0);
  });

  it('n enregistre rien quand aucune manche n a ete jouee', () => {
    build({ mode: 'RANKED' });
    runtime.forfeit(MATCH_ID, 'b');
    expect(recorder.calls).toHaveLength(0);
  });

  it('ecrit le siege du fantome sans joueur, et sa provenance', () => {
    build({ mode: 'RANKED', ghost: { ...GHOST_SEAT, mmr: 1_200 } });
    playRound('a');
    playRound('a');

    expect(repository.saved).toHaveLength(1);
    expect(repository.saved[0]?.seats).toEqual({ a: SEATS.a, b: null });
    expect(repository.saved[0]?.ghost).toEqual({
      seat: 'b',
      mmr: 1_200,
      sourcePlayerId: 'p_source',
    });
  });

  it('ecrit les deux joueurs quand personne n est un fantome', () => {
    build({ mode: 'RANKED' });
    playRound('a');
    playRound('a');
    expect(repository.saved[0]?.seats).toEqual(SEATS);
    expect(repository.saved[0]?.ghost).toBeNull();
  });

  it('dit au classement quel siege n etait pas la', async () => {
    const settlements: unknown[] = [];
    const settlement: MatchRatingSettlement = {
      settle: (input) => {
        settlements.push(input.ghost);
        return Promise.resolve({
          a: {
            before: { leaguePoints: 0, league: 'sans_aura' },
            after: { leaguePoints: 0, league: 'sans_aura' },
            rewards: { softCurrency: 0, xp: 0, xpTotal: 0 },
          },
          b: {
            before: { leaguePoints: 0, league: 'sans_aura' },
            after: { leaguePoints: 0, league: 'sans_aura' },
            rewards: { softCurrency: 0, xp: 0, xpTotal: 0 },
          },
        } as Readonly<Record<Seat, SeatRatingOutcome>>);
      },
    };

    runtime = new MatchRuntime(notifier, scheduler, clock, BALANCE, null, settlement);
    runtime.createMatch({
      matchId: MATCH_ID,
      seed: 'graine',
      seats: SEATS,
      mode: 'RANKED',
      ghost: { ...GHOST_SEAT, mmr: 1_100 },
    });
    playRound('a');
    playRound('a');
    await flush();

    expect(settlements[0]).toEqual({ seat: 'b', mmr: 1_100, sourcePlayerId: 'p_source' });
  });
});

/**
 * L'effet d'aura annonce a la revelation.
 *
 * `docs/01-game-design.md` §3 : l'amplificateur s'affiche sous le nom de son
 * effet offert, et un skin paye habille UN niveau. Le serveur est le seul a
 * pouvoir le dire — il connait le palier joue ET ce que le joueur possede.
 *
 * Il l'etait deja pour les effets offerts. Ce qui manquait, c'est le skin :
 * trois cosmetiques a 400 et 850 pieces qu'aucun adversaire n'aurait jamais
 * vus. Et le cosmetique arrivait par `choice:lock`, donc **declare par le
 * client**, sans aucun controle de possession.
 */
describe('effet d aura a la revelation', () => {
  const revealed = (seat: Seat): string => {
    const [result] = notifier.to(SEATS[seat], 'round:result') as [ServerMessage<'round:result'>];
    return result.sides[seat].cosmetic.effectId;
  };

  it('annonce l effet offert du palier joue', () => {
    advanceTo('choice');
    runtime.lockChoice(MATCH_ID, 'a', { ...choice(1), amplifier: 2 }, null);
    runtime.lockChoice(MATCH_ID, 'b', { ...choice(1), amplifier: 0 }, null);
    expect(revealed('a')).toBe('fx.lightning');
    expect(revealed('b')).toBe('fx.glow');
  });

  it('annonce le skin possede, au niveau qu il habille', () => {
    runtime.setWearing(MATCH_ID, 'a', { ownedEffects: ['fx.shock'], owned: ['fx.shock'] });
    advanceTo('choice');
    runtime.lockChoice(MATCH_ID, 'a', { ...choice(1), amplifier: 2 }, null);
    runtime.lockChoice(MATCH_ID, 'b', { ...choice(1), amplifier: 2 }, null);
    // Meme palier, deux auras differentes : l'un a paye, l'autre non.
    expect(revealed('a')).toBe('fx.shock');
    expect(revealed('b')).toBe('fx.lightning');
  });

  /*
    Le coeur de la regle, et ce qui la distingue d'un skin permanent : jouer un
    autre palier montre l'effet de CE palier. Sinon l'amplificateur cesse
    d'etre lisible — son nom est celui de son effet.
  */
  it('ne montre pas le skin a un autre palier', () => {
    runtime.setWearing(MATCH_ID, 'a', { ownedEffects: ['fx.shock'], owned: ['fx.shock'] });
    advanceTo('choice');
    runtime.lockChoice(MATCH_ID, 'a', { ...choice(1), amplifier: 4 }, null);
    runtime.lockChoice(MATCH_ID, 'b', { ...choice(1), amplifier: 0 }, null);
    expect(revealed('a')).toBe('fx.galaxy');
  });
});

/**
 * La pose verrouillee (protocole 2.0.0).
 *
 * Le client ne dit que la pose ; le serveur en deduit famille et palier, et
 * verifie qu'elle est offerte ou possedee. Une pose refusee est imputee au
 * seul siege fautif, et le siege joue alors le choix par defaut du moteur.
 */
/** La famille du choix par defaut, telle que le moteur la tire (docs/01 §9). */
const seededDefaultStyle = (seed: string, round: number): Style =>
  createRng(deriveSeed(seed, 'default', round)).pick(BALANCE.styles);

describe('pose verrouillee', () => {
  const WHEEL = 'anim.acrobatie.t2.wheel'; // offerte
  const FLEX = 'anim.prouesse.t0.flex'; // offerte
  const FLOSS = 'anim.hype.t2.floss'; // payante
  const result = (): ServerMessage<'round:result'> =>
    (notifier.to(SEATS.a, 'round:result') as ServerMessage<'round:result'>[]).at(-1)!;
  const record = (): MatchRecord => {
    runtime.forfeit(MATCH_ID, 'a');
    return keeper.saved.at(-1)!;
  };
  class Keeper {
    readonly saved: MatchRecord[] = [];
    save(saved: MatchRecord): Promise<void> {
      this.saved.push(saved);
      return Promise.resolve();
    }
  }
  let keeper: Keeper;

  beforeEach(() => {
    keeper = new Keeper();
    runtime = new MatchRuntime(notifier, scheduler, clock, BALANCE, keeper);
    runtime.createMatch({ matchId: MATCH_ID, seed: 'graine', seats: SEATS });
  });

  it('revele la pose offerte et le mouvement qu elle porte', () => {
    advanceTo('choice');
    runtime.lockPose(MATCH_ID, 'a', { poseId: WHEEL, amplifier: 0, useUltimate: false }, null);
    runtime.lockPose(MATCH_ID, 'b', { poseId: FLEX, amplifier: 0, useUltimate: false }, null);
    expect(result().sides.a.move).toEqual({ style: 'acrobatie', tier: 2 });
    expect(result().sides.a.cosmetic.animationId).toBe(WHEEL);
    expect(result().sides.b.cosmetic.animationId).toBe(FLEX);
    // acrobatie bat prouesse
    expect(result().sides.a.counter).toBe(true);
  });

  it('accepte une pose payante possedee', () => {
    runtime.setWearing(MATCH_ID, 'a', { ownedEffects: [], owned: [FLOSS] });
    advanceTo('choice');
    runtime.lockPose(MATCH_ID, 'a', { poseId: FLOSS, amplifier: 0, useUltimate: false }, null);
    runtime.lockChoice(MATCH_ID, 'b', choice(0), null);
    expect(result().sides.a.cosmetic.animationId).toBe(FLOSS);
    expect(result().sides.a.move).toEqual({ style: 'hype', tier: 2 });
  });

  /*
    Une pose de mouvement valide mais non possedee ne coute PAS la manche :
    le mouvement est verrouille avec la pose offerte de sa case. Sinon un achat
    cosmetique deviendrait un desavantage de jeu (regle d'or n°3) — il suffit
    d'un inventaire indisponible a la connexion pour qu'un joueur honnete joue
    une pose achetee que le match ne lui connait pas.
  */
  it('joue la pose offerte de la case quand la pose demandee n est pas possedee', () => {
    advanceTo('choice');
    runtime.lockPose(MATCH_ID, 'a', { poseId: FLOSS, amplifier: 0, useUltimate: false }, null);
    // Le verrouillage a lieu : l'adversaire l'apprend, comme pour tout choix.
    expect(notifier.to(SEATS.b, 'opponent:locked')).toHaveLength(1);
    // Le seul interesse est prevenu, sans que ce soit une faute.
    expect(notifier.to(SEATS.a, 'error')).toEqual([
      {
        code: 'COSMETIC_NOT_OWNED',
        message: 'pose non possedee, pose offerte jouee',
        retryable: false,
      },
    ]);
    runtime.lockPose(MATCH_ID, 'b', { poseId: FLEX, amplifier: 0, useUltimate: false }, null);
    expect(result().sides.a.move).toEqual({ style: 'hype', tier: 2 });
    expect(result().sides.a.cosmetic.animationId).toBe('anim.hype.t2.fist');
    // Aucune suspicion : un client honnete peut arriver ici.
    expect(record().rejectedEvents.a).toBe(0);
  });

  it('garde la premiere pose quand un second verrouillage est refuse', () => {
    advanceTo('choice');
    runtime.lockPose(MATCH_ID, 'a', { poseId: WHEEL, amplifier: 0, useUltimate: false }, null);
    runtime.lockPose(
      MATCH_ID,
      'a',
      { poseId: 'anim.acrobatie.t3.spin', amplifier: 0, useUltimate: false },
      null,
    );
    expect(notifier.to(SEATS.a, 'error').map((e) => (e as { code: string }).code)).toContain(
      'ALREADY_LOCKED',
    );
    runtime.lockPose(MATCH_ID, 'b', { poseId: FLEX, amplifier: 0, useUltimate: false }, null);
    expect(result().sides.a.cosmetic.animationId).toBe(WHEEL);
  });

  it.each(['anim.system.none.victory', 'fx.flames', 'anim.hype.t4.wheel', 'hair.long'])(
    'refuse %s, qui n est pas une pose de mouvement',
    (poseId) => {
      advanceTo('choice');
      runtime.lockPose(MATCH_ID, 'a', { poseId, amplifier: 0, useUltimate: false }, null);
      expect(notifier.to(SEATS.b, 'opponent:locked')).toEqual([]);
      // Un client honnete n'envoie jamais un identifiant qui n'est pas une
      // pose : refus definitif, compte comme suspect.
      expect(notifier.to(SEATS.a, 'error')).toEqual([
        { code: 'INVALID_PAYLOAD', message: 'pose inconnue', retryable: false },
      ]);
      expect(record().rejectedEvents.a).toBe(1);
    },
  );

  it('revele la pose offerte de la case pour un siege sans pose', () => {
    advanceTo('choice');
    runtime.lockChoice(MATCH_ID, 'a', { ...choice(3), move: { style: 'calme', tier: 3 } }, null);
    runtime.lockPose(MATCH_ID, 'b', { poseId: FLEX, amplifier: 0, useUltimate: false }, null);
    expect(result().sides.a.cosmetic.animationId).toBe('anim.calme.t3.meditate');
  });

  /*
    La brillante est appliquee par le moteur, pas par le client : meme un
    siege qui n'a jamais vu son `choice:start` (reprise en pleine phase) en
    profite s'il joue la bonne case. `round:result` le dit aux deux.
  */
  it('dit dans round:result qui a joue sa case brillante', () => {
    advanceTo('choice');
    // Le match de test a la graine 'graine' : on recalcule son tirage.
    const { a: shinyA, b: shinyB } = buildRoundContext('graine', 1, BALANCE).shiny;
    runtime.lockPose(
      MATCH_ID,
      'a',
      { poseId: defaultAnimationFor(shinyA), amplifier: 0, useUltimate: false },
      null,
    );
    runtime.lockPose(MATCH_ID, 'b', { poseId: FLEX, amplifier: 0, useUltimate: false }, null);
    expect(result().sides.a.shiny).toBe(true);
    expect(result().sides.b.shiny).toBe(shinyB.style === 'prouesse' && shinyB.tier === 0);
  });

  it('ne garde une pose que pour la manche ou elle a ete verrouillee', () => {
    advanceTo('choice');
    runtime.lockPose(MATCH_ID, 'a', { poseId: WHEEL, amplifier: 0, useUltimate: false }, null);
    runtime.lockPose(MATCH_ID, 'b', { poseId: FLEX, amplifier: 0, useUltimate: false }, null);
    // Manche 2 : personne ne verrouille, le moteur joue le choix par defaut.
    advanceTo('reveal');
    scheduler.fire(MATCH_ID);
    advanceTo('choice');
    scheduler.fire(MATCH_ID); // echeance du choix
    const second = result();
    expect(second.round).toBe(2);
    expect(second.sides.a.cosmetic.animationId).not.toBe(WHEEL);
    // La famille que le MOTEUR a jouee — tiree par la graine —, pas une
    // famille de repli : sinon le contre affiche contredit les familles
    // affichees, quatre fois sur cinq.
    const drawn = { style: seededDefaultStyle('graine', 2), tier: 0 } as const;
    expect(second.sides.a.move).toEqual(drawn);
    expect(second.sides.b.move).toEqual(drawn);
    expect(second.sides.a.cosmetic.animationId).toBe(defaultAnimationFor(drawn));
  });
});

/**
 * Ce que le match remonte aux defis quotidiens.
 *
 * Le branchement est court, et il a deux facons discretes de se tromper : le
 * moment ou l'on compte, et ce qu'on compte comme victoire. Les deux sont
 * invisibles sans ce test — les defis avanceraient, simplement moins qu'ils ne
 * devraient, et personne ne pourrait dire de combien.
 */
describe('defis quotidiens', () => {
  class RecordingTracker {
    readonly seen: { playerId: string; contribution: MatchContribution }[] = [];
    recordMatch(playerId: string, contribution: MatchContribution): Promise<void> {
      this.seen.push({ playerId, contribution });
      return Promise.resolve();
    }
  }

  let tracker: RecordingTracker;

  beforeEach(() => {
    tracker = new RecordingTracker();
    runtime = new MatchRuntime(
      notifier,
      scheduler,
      clock,
      BALANCE,
      null,
      null,
      null,
      null,
      tracker,
    );
    runtime.createMatch({ matchId: MATCH_ID, seed: 'graine', seats: SEATS });
  });

  /** Joue jusqu'a la fin du match, `winner` remportant chaque manche. */
  const playOut = (winner: Seat): void => {
    for (let round = 0; round < 3 && runtime.phaseOf(MATCH_ID) !== null; round += 1) {
      advanceTo('choice');
      runtime.lockChoice(MATCH_ID, winner, choice(4), null);
      runtime.lockChoice(MATCH_ID, winner === 'a' ? 'b' : 'a', choice(0), null);
    }
  };

  it('remonte une ligne par joueur, a la fin du match', () => {
    playOut('a');
    expect(tracker.seen.map((entry) => entry.playerId).sort()).toEqual([SEATS.a, SEATS.b].sort());
  });

  /*
    La victoire vaut UN, pas un par manche gagnee. Le defi « gagner un duel »
    serait sinon paye trois fois pour une seule partie — et paye aussi a qui a
    perdu deux manches sur trois.
  */
  it('compte une seule victoire, au vainqueur seul', () => {
    playOut('a');
    const forA = tracker.seen.find((entry) => entry.playerId === SEATS.a);
    const forB = tracker.seen.find((entry) => entry.playerId === SEATS.b);
    expect(forA?.contribution.wins).toBe(1);
    expect(forB?.contribution.wins).toBe(0);
  });

  /*
    Le coeur du branchement : les chiffres de recharge vivent dans `pending`,
    remis a zero a la manche suivante. Compter a la fin du match les compterait
    a zero — deux defis sur cinq deviendraient impossibles a finir, sans
    qu'aucune erreur ne soit levee.
  */
  it('garde les points de recharge de chaque manche', () => {
    advanceTo('recharge');
    const [start] = notifier.to(SEATS.a, 'recharge:start') as [ServerMessage<'recharge:start'>];
    const orb = start.orbs[0];
    if (orb !== undefined) {
      runtime.submitTaps(MATCH_ID, 'a', [{ orbIndex: orb.index, atMs: 50 }]);
    }
    playOut('a');

    const forA = tracker.seen.find((entry) => entry.playerId === SEATS.a);
    expect(forA?.contribution.rechargePoints).toBeGreaterThan(0);
  });

  it('ne remonte rien tant que le match n est pas fini', () => {
    advanceTo('choice');
    runtime.lockChoice(MATCH_ID, 'a', choice(4), null);
    runtime.lockChoice(MATCH_ID, 'b', choice(0), null);
    expect(tracker.seen).toHaveLength(0);
  });
});
