import {
  MAX_TAPS_PER_MESSAGE,
  MIN_CHARGE_TO_TAP_MS,
  parseServerMessage,
  type ServerMessage,
  type ServerMessageName,
} from '@aura/protocol';
import {
  BALANCE,
  choiceCost,
  createRng,
  evaluateTiming,
  generateGaugeParams,
  generateOrbSequence,
  variantConfig,
  type BalanceConfig,
  type Choice,
  type RechargeTap,
  type Seat,
} from '@aura/rules';
import { describe, expect, it } from 'vitest';
import type { GhostRecording, GhostRound } from '../domain/ghost.js';
import { GhostDirector, type GhostActions } from './ghost-director.js';

/**
 * Rejeu d'un enregistrement (docs/05 § « Fantomes »).
 *
 * Ce qui est eprouve ici n'est pas « le fantome joue bien » mais « le fantome
 * joue **comme un client** » : il passe par `acceptSeq`, il declare des
 * instants qu'il a laisses s'ecouler, il ne depasse pas la phase, et il ne
 * propose jamais un choix que le moteur refuserait.
 */

const GAUGE = generateGaugeParams(createRng('jauge-de-test'));
const ORBS = generateOrbSequence(createRng('orbes-de-test'));

/** Ordonnanceur pilote a la main : rien ne se declenche sans qu'on l'ait voulu. */
class TestScheduler {
  readonly armed = new Map<string, { atMs: number; run: () => void }>();

  schedule(key: string, atMs: number, run: () => void): void {
    this.armed.set(key, { atMs, run });
  }

  cancel(key: string): void {
    this.armed.delete(key);
  }

  /** Declenche, dans l'ordre chronologique, tout ce qui echoit avant `untilMs`. */
  runUntil(untilMs: number): void {
    for (;;) {
      const due = [...this.armed.entries()]
        .filter(([, timer]) => timer.atMs <= untilMs)
        .sort(([, left], [, right]) => left.atMs - right.atMs);
      if (due.length === 0) return;
      const [key, timer] = due[0]!;
      this.armed.delete(key);
      timer.run();
    }
  }
}

interface Submitted {
  readonly seq: number;
  readonly atMs: number;
  readonly taps: readonly RechargeTap[];
}

interface Locked {
  readonly seq: number;
  readonly atMs: number;
  readonly choice: Choice;
  readonly timingTapAtMs: number | null;
}

/**
 * Le runtime, reduit a ce que la passerelle en utilise.
 *
 * `acceptSeq` est reproduit a l'identique — un numero doit croitre strictement
 * — parce que c'est justement ce qu'on veut verifier : le fantome n'a pas de
 * dispense.
 */
class TestRuntime implements GhostActions {
  readonly submitted: Submitted[] = [];
  readonly locked: Locked[] = [];
  private lastSeq = 0;
  /** Les regles du match ; `null`, celles du directeur. */
  config: BalanceConfig | null = null;

  constructor(private readonly clock: { now(): number }) {}

  configOf(_matchId: string): BalanceConfig | null {
    return this.config;
  }

  acceptSeq(_matchId: string, _seat: Seat, seq: number): boolean {
    if (seq <= this.lastSeq) return false;
    this.lastSeq = seq;
    return true;
  }

  submitTaps(_matchId: string, _seat: Seat, taps: readonly RechargeTap[]): void {
    this.submitted.push({ seq: this.lastSeq, atMs: this.clock.now(), taps });
  }

  lockChoice(_matchId: string, _seat: Seat, choice: Choice, timingTapAtMs: number | null): void {
    this.locked.push({ seq: this.lastSeq, atMs: this.clock.now(), choice, timingTapAtMs });
  }
}

const aRound = (over: Partial<GhostRound> = {}): GhostRound => ({
  move: { style: 'hype', tier: 2 },
  amplifier: 1,
  useUltimate: false,
  timing: { quality: 'good', delta: 0.06 },
  rechargePoints: 11,
  rechargeTaps: 12,
  ...over,
});

const aRecording = (rounds: readonly GhostRound[]): GhostRecording => ({
  id: 'rec_1',
  playerId: 'p_source',
  mmr: 1000,
  rulesVersion: '1.0.0',
  rounds,
});

const PHASE_START = 1_000_000;

interface Banc {
  readonly director: GhostDirector;
  readonly scheduler: TestScheduler;
  readonly runtime: TestRuntime;
  readonly clock: { now(): number };
  setNow(atMs: number): void;
  deliver<N extends ServerMessageName>(name: N, payload: ServerMessage<N>): void;
}

function banc(recording: GhostRecording, startAtMs = PHASE_START): Banc {
  let nowMs = startAtMs;
  const clock = { now: () => nowMs };
  const scheduler = new TestScheduler();
  const runtime = new TestRuntime(clock);
  const director = new GhostDirector(scheduler, clock, BALANCE);

  director.attach({
    ghostPlayerId: 'ghost:rec_1:nonce',
    matchId: 'm_1',
    seat: 'b',
    recording,
    actions: runtime,
  });

  return {
    director,
    scheduler,
    runtime,
    clock,
    setNow: (atMs: number) => {
      nowMs = atMs;
    },
    deliver<N extends ServerMessageName>(name: N, payload: ServerMessage<N>): void {
      // Le decorateur reel analyse le message par son schema avant de le
      // remettre ; on fait pareil, sinon ce banc testerait un chemin qui
      // n'existe pas.
      const parsed = parseServerMessage(name, payload);
      if (!parsed.success) throw new Error(`message de test invalide : ${parsed.error}`);
      director.deliver('ghost:rec_1:nonce', parsed.data);
    },
  };
}

const rechargeStart = (round: 1 | 2 | 3 = 1): ServerMessage<'recharge:start'> => ({
  matchId: 'm_1',
  round,
  startsAt: PHASE_START,
  endsAt: PHASE_START + BALANCE.phases.rechargeMs,
  orbs: ORBS.map((orb) => ({
    index: orb.index,
    x: orb.x,
    y: orb.y,
    kind: orb.kind,
    points: orb.points,
    lifetimeMs: orb.lifetimeMs,
  })),
});

const choiceStart = (
  over: Partial<ServerMessage<'choice:start'>> = {},
): ServerMessage<'choice:start'> => ({
  matchId: 'm_1',
  round: 1,
  endsAt: PHASE_START + BALANCE.phases.choiceMs,
  meter: {
    period: GAUGE.periodMs,
    zone: GAUGE.zoneWidth,
    perfect: GAUGE.perfectWidth,
    center: GAUGE.center,
  },
  energy: 14,
  ult: 0,
  ...over,
});

describe('GhostDirector — la recharge passe par la meme porte qu un client', () => {
  it('envoie ses taps par lots, etales sur la phase', () => {
    const b = banc(aRecording([aRound({ rechargeTaps: 12 })]));
    b.deliver('recharge:start', rechargeStart());

    // Rien n'est envoye a l'annonce : tout est programme.
    expect(b.runtime.submitted).toHaveLength(0);

    for (const echeance of [...b.scheduler.armed.values()]) {
      expect(echeance.atMs).toBeGreaterThan(PHASE_START);
    }

    b.scheduler.runUntil(PHASE_START + BALANCE.phases.rechargeMs);
    expect(b.runtime.submitted.length).toBeGreaterThan(1);
  });

  /**
   * Le defaut que ce test ferme : un fantome qui enverrait toute sa recharge a
   * la premiere milliseconde declarerait six secondes de jeu avant qu'elles ne
   * se soient ecoulees. Le serveur le compterait comme un instant impossible —
   * exactement le signal de `docs/06` — et le tap ne compterait pas.
   */
  it('ne declare jamais un tap avant de l avoir vecu', () => {
    const b = banc(aRecording([aRound({ rechargeTaps: 20 })]));
    b.deliver('recharge:start', rechargeStart());

    const echeances = [...b.scheduler.armed.values()].sort((l, r) => l.atMs - r.atMs);
    for (const echeance of echeances) {
      b.setNow(echeance.atMs);
      echeance.run();
    }

    const TOLERANCE_MS = 400 + 250; // taps + horloge (match-runtime.ts)
    for (const envoi of b.runtime.submitted) {
      const ecoule = envoi.atMs - PHASE_START;
      for (const tap of envoi.taps) {
        expect(tap.atMs).toBeLessThanOrEqual(ecoule + TOLERANCE_MS);
      }
    }
  });

  it('ne tape jamais apres la fin de la phase', () => {
    const b = banc(aRecording([aRound({ rechargeTaps: 60 })]));
    b.deliver('recharge:start', rechargeStart());
    b.scheduler.runUntil(Number.MAX_SAFE_INTEGER);

    const endsAt = PHASE_START + BALANCE.phases.rechargeMs;
    for (const envoi of b.runtime.submitted) {
      expect(envoi.atMs).toBeLessThan(endsAt);
      for (const tap of envoi.taps) {
        expect(tap.atMs).toBeLessThanOrEqual(BALANCE.phases.rechargeMs);
      }
    }
  });

  it('numerote ses envois de facon strictement croissante', () => {
    const b = banc(aRecording([aRound({ rechargeTaps: 12 })]));
    b.deliver('recharge:start', rechargeStart());
    b.scheduler.runUntil(Number.MAX_SAFE_INTEGER);

    const seqs = b.runtime.submitted.map((envoi) => envoi.seq);
    expect(seqs).toEqual([...seqs].sort((l, r) => l - r));
    expect(new Set(seqs).size).toBe(seqs.length);
  });

  it('reste sous le plafond de douze taps par seconde', () => {
    const b = banc(aRecording([aRound({ rechargeTaps: 60 })]));
    b.deliver('recharge:start', rechargeStart());
    b.scheduler.runUntil(Number.MAX_SAFE_INTEGER);

    const tous = b.runtime.submitted.flatMap((envoi) => envoi.taps).sort((l, r) => l.atMs - r.atMs);
    for (const tap of tous) {
      const fenetre = tous.filter(
        (autre) => autre.atMs > tap.atMs - 1_000 && autre.atMs <= tap.atMs,
      );
      expect(fenetre.length).toBeLessThanOrEqual(BALANCE.recharge.maxTapsPerSecond);
    }
  });

  it('ne tape pas du tout quand l enregistrement ne tapait pas', () => {
    const b = banc(aRecording([aRound({ rechargeTaps: 0 })]));
    b.deliver('recharge:start', rechargeStart());
    b.scheduler.runUntil(Number.MAX_SAFE_INTEGER);
    expect(b.runtime.submitted).toHaveLength(0);
  });
});

describe('GhostDirector — le choix', () => {
  it('rejoue le choix enregistre quand l energie le couvre', () => {
    const voulu = aRound({ move: { style: 'provoc', tier: 3 }, amplifier: 2 });
    const b = banc(aRecording([voulu]));
    b.deliver('choice:start', choiceStart({ energy: 14 }));
    b.scheduler.runUntil(Number.MAX_SAFE_INTEGER);

    expect(b.runtime.locked).toHaveLength(1);
    expect(b.runtime.locked[0]?.choice).toEqual({
      move: { style: 'provoc', tier: 3 },
      amplifier: 2,
      useUltimate: false,
    });
  });

  /**
   * Le rejeu se fait dans une **autre** partie : l'energie n'a pas suivi le
   * meme chemin. Un choix impayable doit etre rabattu, pas refuse — un choix
   * refuse laisserait le fantome jouer l'action par defaut, donc rien.
   */
  it('rabat un choix devenu impayable, sans jamais depasser l energie', () => {
    const b = banc(aRecording([aRound({ move: { style: 'provoc', tier: 4 }, amplifier: 4 })]));
    b.deliver('choice:start', choiceStart({ energy: 2 }));
    b.scheduler.runUntil(Number.MAX_SAFE_INTEGER);

    const choix = b.runtime.locked[0]?.choice;
    expect(choix).toBeDefined();
    expect(choix!.move.style).toBe('provoc');
    expect(choiceCost(choix!)).toBeLessThanOrEqual(2);
  });

  it('n active pas l Ultime quand la jauge n est pas pleine', () => {
    const b = banc(aRecording([aRound({ useUltimate: true })]));
    b.deliver('choice:start', choiceStart({ ult: 60 }));
    b.scheduler.runUntil(Number.MAX_SAFE_INTEGER);
    expect(b.runtime.locked[0]?.choice.useUltimate).toBe(false);
  });

  /** Evenements de la semaine : le fantome joue les regles de SON match. */
  it('lit la jauge d Ultime dans les regles du match, pas dans les siennes', () => {
    const b = banc(aRecording([aRound({ useUltimate: true })]));
    b.runtime.config = variantConfig('ultime');
    b.deliver('choice:start', choiceStart({ ult: 60 }));
    b.scheduler.runUntil(Number.MAX_SAFE_INTEGER);
    expect(b.runtime.locked[0]?.choice.useUltimate).toBe(true);
  });

  it('active l Ultime quand la jauge est pleine', () => {
    const b = banc(aRecording([aRound({ useUltimate: true })]));
    b.deliver('choice:start', choiceStart({ ult: BALANCE.ultimate.gaugeMax }));
    b.scheduler.runUntil(Number.MAX_SAFE_INTEGER);
    expect(b.runtime.locked[0]?.choice.useUltimate).toBe(true);
  });

  /**
   * Le coeur du rejeu de timing : l'enregistrement porte un **ecart**, pas un
   * instant. Sur la jauge de cette manche-ci, l'instant recalcule doit rendre
   * le meme ecart — et donc la meme qualite.
   */
  it('retrouve la qualite enregistree sur la jauge de cette manche', () => {
    const b = banc(aRecording([aRound({ timing: { quality: 'perfect', delta: 0.01 } })]));
    b.deliver('choice:start', choiceStart());
    b.scheduler.runUntil(Number.MAX_SAFE_INTEGER);

    const tap = b.runtime.locked[0]?.timingTapAtMs;
    expect(tap).not.toBeNull();
    const rejoue = evaluateTiming(tap!, GAUGE);
    expect(rejoue.quality).toBe('perfect');
    expect(rejoue.delta).toBeCloseTo(0.01, 6);
  });

  it('ne declare aucun tap quand le joueur enregistre n avait pas tape', () => {
    const b = banc(aRecording([aRound({ timing: { quality: 'miss', delta: 1 } })]));
    b.deliver('choice:start', choiceStart());
    b.scheduler.runUntil(Number.MAX_SAFE_INTEGER);
    expect(b.runtime.locked[0]?.timingTapAtMs).toBeNull();
  });

  /**
   * Meme confrontation que pour les taps : un verrouillage qui annonce une
   * charge plus longue que le temps ecoule est refuse par le serveur.
   */
  it('laisse s ecouler la charge qu il declare', () => {
    const b = banc(aRecording([aRound({ timing: { quality: 'good', delta: 0.09 } })]));
    b.deliver('choice:start', choiceStart());

    const echeances = [...b.scheduler.armed.values()];
    expect(echeances).toHaveLength(1);
    b.setNow(echeances[0]!.atMs);
    echeances[0]!.run();

    const verrou = b.runtime.locked[0]!;
    const ecoule = verrou.atMs - PHASE_START;
    expect(verrou.timingTapAtMs).not.toBeNull();
    expect(verrou.timingTapAtMs!).toBeLessThanOrEqual(ecoule);
  });

  it('verrouille avant la fin de la phase de choix', () => {
    const b = banc(aRecording([aRound()]));
    const message = choiceStart();
    b.deliver('choice:start', message);
    b.scheduler.runUntil(Number.MAX_SAFE_INTEGER);
    expect(b.runtime.locked[0]?.atMs).toBeLessThan(message.endsAt);
  });

  /** Une belle a jouer avec un enregistrement de deux manches : on rejoue la derniere. */
  it('rejoue la derniere manche connue quand l enregistrement est plus court', () => {
    const b = banc(
      aRecording([
        aRound({ move: { style: 'calme', tier: 0 } }),
        aRound({ move: { style: 'hype', tier: 4 } }),
      ]),
    );
    b.deliver('choice:start', choiceStart({ round: 3 }));
    b.scheduler.runUntil(Number.MAX_SAFE_INTEGER);
    expect(b.runtime.locked[0]?.choice.move).toEqual({ style: 'hype', tier: 4 });
  });

  it('evite de rejouer un mouvement qu il a deja joue quand il doit s adapter', () => {
    const repete = aRound({ move: { style: 'calme', tier: 4 }, amplifier: 4 });
    const b = banc(aRecording([repete, repete]));

    b.deliver('choice:start', choiceStart({ round: 1, energy: 8 }));
    b.scheduler.runUntil(Number.MAX_SAFE_INTEGER);
    b.deliver('choice:start', choiceStart({ round: 2, energy: 4 }));
    b.scheduler.runUntil(Number.MAX_SAFE_INTEGER);

    expect(b.runtime.locked).toHaveLength(2);
    expect(b.runtime.locked[1]?.choice.move).not.toEqual(b.runtime.locked[0]?.choice.move);
  });
});

describe('GhostDirector — cycle de vie', () => {
  it('oublie le fantome et desarme ses echeances a la fin du match', () => {
    const b = banc(aRecording([aRound()]));
    b.deliver('recharge:start', rechargeStart());
    expect(b.scheduler.armed.size).toBeGreaterThan(0);

    b.deliver('match:end', {
      matchId: 'm_1',
      winner: 'a',
      reason: 'rounds',
      rating: { before: 0, after: 0, leagueBefore: 'sans_aura', leagueAfter: 'sans_aura' },
      rewards: { softCurrency: 0, xp: 0, xpTotal: 0 },
    });

    expect(b.scheduler.armed.size).toBe(0);
    expect(b.director.size).toBe(0);
    expect(b.director.isDriving('ghost:rec_1:nonce')).toBe(false);
  });

  it('ignore un message adresse a un siege qu il ne pilote pas', () => {
    const b = banc(aRecording([aRound()]));
    const parsed = parseServerMessage('recharge:start', rechargeStart());
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;

    b.director.deliver('ghost:inconnu:x', parsed.data);
    expect(b.scheduler.armed.size).toBe(0);
  });

  it('ne reagit pas a ce que fait son adversaire', () => {
    const b = banc(aRecording([aRound()]));
    b.deliver('opponent:locked', { matchId: 'm_1', round: 1 });
    b.deliver('round:intro', {
      matchId: 'm_1',
      round: 1,
      endsAt: PHASE_START,
      roundsWon: { a: 0, b: 0 },
      energy: 14,
      ult: 0,
    });
    expect(b.scheduler.armed.size).toBe(0);
    expect(b.runtime.submitted).toHaveLength(0);
    expect(b.runtime.locked).toHaveLength(0);
  });
});

/**
 * Bornes du protocole (`@aura/protocol`).
 *
 * Le rejeu n'emprunte pas le fil : il appelle le runtime directement, donc les
 * schemas entrants ne s'appliquent pas a lui. Ce qu'ils bornent doit donc etre
 * borne **ici**, faute de quoi un fantome pourrait obtenir ce qu'aucun client
 * ne peut envoyer.
 */
describe('GhostDirector — ne depasse jamais ce qu un client peut envoyer', () => {
  it('ne declare pas un tap trop rapproche du lancement de la charge', () => {
    // Centre bas et gros ecart : l'instant reconstruit tombe tres tot dans la
    // periode — sous le plancher que le protocole impose a un client.
    const gaugeBasse = { periodMs: 1_500, center: 0.3, zoneWidth: 0.22, perfectWidth: 0.08 };
    const b = banc(aRecording([aRound({ timing: { quality: 'miss', delta: 0.25 } })]));

    b.deliver(
      'choice:start',
      choiceStart({
        meter: {
          period: gaugeBasse.periodMs,
          zone: gaugeBasse.zoneWidth,
          perfect: gaugeBasse.perfectWidth,
          center: gaugeBasse.center,
        },
      }),
    );
    b.scheduler.runUntil(Number.MAX_SAFE_INTEGER);

    const tap = b.runtime.locked[0]?.timingTapAtMs ?? null;
    expect(tap === null || tap >= MIN_CHARGE_TO_TAP_MS).toBe(true);
  });

  it('n envoie jamais plus de taps qu un message n en accepte', () => {
    const b = banc(aRecording([aRound({ rechargeTaps: 200 })]));
    b.deliver('recharge:start', rechargeStart());
    b.scheduler.runUntil(Number.MAX_SAFE_INTEGER);

    for (const envoi of b.runtime.submitted) {
      expect(envoi.taps.length).toBeLessThanOrEqual(MAX_TAPS_PER_MESSAGE);
    }
  });

  it('envoie ses taps dans l ordre croissant, comme le schema l exige', () => {
    const b = banc(aRecording([aRound({ rechargeTaps: 18 })]));
    b.deliver('recharge:start', rechargeStart());
    b.scheduler.runUntil(Number.MAX_SAFE_INTEGER);

    for (const envoi of b.runtime.submitted) {
      const instants = envoi.taps.map((tap) => tap.atMs);
      expect(instants).toEqual([...instants].sort((left, right) => left - right));
    }
  });
});
