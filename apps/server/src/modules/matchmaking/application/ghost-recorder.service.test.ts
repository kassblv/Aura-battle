import { RULES_VERSION, type Seat } from '@aura/rules';
import { describe, expect, it } from 'vitest';
import type { GhostRoundTrace } from '../../match/domain/ports.js';
import type { GhostRecording, GhostRound } from '../domain/ghost.js';
import type { GhostRecordingStore, RatingReader } from '../domain/ports.js';
import { DEFAULT_MMR } from '../domain/ticket.js';
import { GhostRecorderService } from './ghost-recorder.service.js';

/**
 * Enregistrement des fantomes (docs/05 § « Fantomes »).
 *
 * Le runtime apporte les choix, les timings et la recharge ; ce service n'y
 * ajoute que le MMR. Ce qui est eprouve ici est donc exactement cela : le bon
 * MMR sur le bon joueur, et rien qui fasse echouer une fin de match.
 */

interface Saved {
  readonly playerId: string;
  readonly mmr: number;
  readonly rulesVersion: string;
  readonly rounds: readonly GhostRound[];
  readonly atMs: number;
}

class TestStore implements GhostRecordingStore {
  readonly saved: Saved[] = [];
  failFor: string | null = null;

  candidates(): Promise<readonly GhostRecording[]> {
    return Promise.resolve([]);
  }

  save(recording: Saved): Promise<void> {
    if (recording.playerId === this.failFor) return Promise.reject(new Error('ecriture refusee'));
    this.saved.push(recording);
    return Promise.resolve();
  }
}

class TestRatings implements RatingReader {
  fail = false;
  constructor(private readonly mmrs: ReadonlyMap<string, number> = new Map()) {}

  mmrOf(playerIds: readonly string[]): Promise<ReadonlyMap<string, number>> {
    if (this.fail) return Promise.reject(new Error('classement illisible'));
    const known: [string, number][] = [];
    for (const id of playerIds) {
      const mmr = this.mmrs.get(id);
      if (mmr !== undefined) known.push([id, mmr]);
    }
    return Promise.resolve(new Map(known));
  }
}

const aTrace = (over: Partial<GhostRoundTrace> = {}): GhostRoundTrace => ({
  move: { style: 'hype', tier: 2 },
  amplifier: 1,
  useUltimate: false,
  timing: { quality: 'good', delta: 0.08 },
  rechargePoints: 9,
  rechargeTaps: 11,
  ...over,
});

const SEATS: Readonly<Record<Seat, string>> = { a: 'p_alice', b: 'p_bob' };
const NOW = 1_700_000_000_000;

const record = (
  store: TestStore,
  ratings: TestRatings,
  rounds: Readonly<Record<Seat, readonly GhostRoundTrace[]>> = { a: [aTrace()], b: [aTrace()] },
): Promise<void> =>
  new GhostRecorderService(store, ratings).record({
    matchId: 'm_1',
    seats: SEATS,
    rounds,
    atMs: NOW,
  });

describe('GhostRecorderService', () => {
  it('enregistre un fantome par joueur, avec son MMR', async () => {
    const store = new TestStore();
    await record(
      store,
      new TestRatings(
        new Map([
          ['p_alice', 1_240],
          ['p_bob', 980],
        ]),
      ),
    );

    expect(store.saved).toHaveLength(2);
    expect(store.saved.find((s) => s.playerId === 'p_alice')?.mmr).toBe(1_240);
    expect(store.saved.find((s) => s.playerId === 'p_bob')?.mmr).toBe(980);
  });

  it('marque la version des regles, pour ne rejouer que ce qui est comparable', async () => {
    const store = new TestStore();
    await record(store, new TestRatings());
    expect(store.saved[0]?.rulesVersion).toBe(RULES_VERSION);
  });

  it('donne le MMR de depart a un joueur sans classement', async () => {
    const store = new TestStore();
    await record(store, new TestRatings());
    expect(store.saved[0]?.mmr).toBe(DEFAULT_MMR);
  });

  /**
   * Une panne de classement ne doit pas faire perdre l'enregistrement : un
   * fantome a 1000 reste credible pour un debutant, et c'est exactement la
   * population qui souffre d'une file vide.
   */
  it('enregistre quand meme quand le classement est illisible', async () => {
    const store = new TestStore();
    const ratings = new TestRatings();
    ratings.fail = true;

    await record(store, ratings);

    expect(store.saved).toHaveLength(2);
    expect(store.saved[0]?.mmr).toBe(DEFAULT_MMR);
  });

  it('n enregistre pas un siege qui n a joue aucune manche', async () => {
    const store = new TestStore();
    await record(store, new TestRatings(), { a: [aTrace()], b: [] });

    expect(store.saved.map((s) => s.playerId)).toEqual(['p_alice']);
  });

  /** Les deux lignes sont independantes : ce ne sont pas deux moities d'un match. */
  it('enregistre un joueur meme si l ecriture de l autre echoue', async () => {
    const store = new TestStore();
    store.failFor = 'p_alice';

    await expect(record(store, new TestRatings())).resolves.toBeUndefined();
    expect(store.saved.map((s) => s.playerId)).toEqual(['p_bob']);
  });

  it('conserve les manches telles que le runtime les a vues', async () => {
    const store = new TestStore();
    const manche = aTrace({ move: { style: 'provoc', tier: 4 }, amplifier: 3, useUltimate: true });
    await record(store, new TestRatings(), { a: [manche], b: [] });

    expect(store.saved[0]?.rounds).toEqual([manche]);
  });
});
