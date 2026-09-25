import { BALANCE, RULES_VERSION, type Choice, type RechargeTap, type Seat } from '@aura/rules';
import { describe, expect, it } from 'vitest';
import { GHOST_DISPLAY_NAME, isGhostSeatId, type GhostRecording } from '../domain/ghost.js';
import type { GhostRecordingStore, MatchOpening } from '../domain/ports.js';
import { DEFAULT_REGION, type QueueTicket } from '../domain/ticket.js';
import { GhostDirector, type GhostActions } from './ghost-director.js';
import { GhostFallbackService } from './ghost-fallback.service.js';

/**
 * Bascule d'un ticket vers un fantome (docs/05 § « Fantomes »).
 *
 * L'ordre — lire, reclamer, ouvrir — est ce que ces tests eprouvent : c'est lui
 * qui empeche d'ouvrir deux matchs a la meme personne, et lui qui garantit
 * qu'un ticket sorti de la file y revient quand rien ne s'ouvre.
 */

const ticket = (over: Partial<QueueTicket> = {}): QueueTicket => ({
  playerId: 'p_seul',
  mode: 'ranked',
  mmr: 1000,
  enqueuedAtMs: 0,
  region: DEFAULT_REGION,
  recentOpponents: [],
  ...over,
});

const recording = (over: Partial<GhostRecording> = {}): GhostRecording => ({
  id: 'rec_1',
  playerId: 'p_source',
  mmr: 1000,
  rulesVersion: RULES_VERSION,
  rounds: [
    {
      move: { style: 'calme', tier: 1 },
      amplifier: 0,
      useUltimate: false,
      timing: { quality: 'good', delta: 0.05 },
      rechargePoints: 10,
      rechargeTaps: 10,
    },
  ],
  ...over,
});

class TestStore implements GhostRecordingStore {
  constructor(private readonly available: readonly GhostRecording[] = []) {}
  readonly saved: unknown[] = [];
  fail = false;

  candidates(): Promise<readonly GhostRecording[]> {
    if (this.fail) return Promise.reject(new Error('base indisponible'));
    return Promise.resolve(this.available);
  }

  save(recordingToSave: unknown): Promise<void> {
    this.saved.push(recordingToSave);
    return Promise.resolve();
  }
}

class TestQueue {
  claimable = true;
  readonly claimed: string[] = [];

  claimForGhost(playerId: string): Promise<boolean> {
    this.claimed.push(playerId);
    return Promise.resolve(this.claimable);
  }
}

class TestOpener implements MatchOpening {
  readonly requests: Parameters<MatchOpening['open']>[0][] = [];
  result: string | null = 'm_1';

  open(request: Parameters<MatchOpening['open']>[0]): string | null {
    this.requests.push(request);
    return this.result;
  }
}

const NO_ACTIONS: GhostActions = {
  acceptSeq: () => true,
  submitTaps: (_matchId: string, _seat: Seat, _taps: readonly RechargeTap[]) => undefined,
  lockChoice: (_matchId: string, _seat: Seat, _choice: Choice, _tap: number | null) => undefined,
  configOf: () => null,
};

function banc(store: TestStore = new TestStore([recording()])) {
  const queue = new TestQueue();
  const opener = new TestOpener();
  const director = new GhostDirector(
    { schedule: () => undefined, cancel: () => undefined },
    { now: () => 0 },
    BALANCE,
  );
  const service = new GhostFallbackService(queue, store, opener, director, NO_ACTIONS);
  return { queue, opener, director, service, store };
}

describe('GhostFallbackService — offrir un adversaire a qui attend seul', () => {
  it('n ouvre rien avant le delai du mode', async () => {
    const b = banc();
    expect(await b.service.tryOpen(ticket(), 24_999)).toBe('skipped');
    expect(b.queue.claimed).toHaveLength(0);
    expect(b.opener.requests).toHaveLength(0);
  });

  it('ouvre un match contre un fantome apres vingt-cinq secondes', async () => {
    const b = banc();
    expect(await b.service.tryOpen(ticket(), 25_000)).toBe('opened');

    const demande = b.opener.requests[0]!;
    expect(demande.playerA).toBe('p_seul');
    expect(isGhostSeatId(demande.playerB)).toBe(true);
    expect(demande.mode).toBe('RANKED');
    expect(demande.ghost?.seat).toBe('b');
    expect(demande.ghost?.sourcePlayerId).toBe('p_source');
    expect(demande.ghost?.displayName).toBe(GHOST_DISPLAY_NAME);
  });

  it('ouvre en partie rapide au bout de douze secondes', async () => {
    const b = banc();
    expect(await b.service.tryOpen(ticket({ mode: 'casual' }), 12_000)).toBe('opened');
    expect(b.opener.requests[0]?.mode).toBe('CASUAL');
  });

  /**
   * L'ordre qui compte : la lecture en base est la seule attente du chemin, et
   * le ticket doit y survivre — un humain qui se presente pendant ce temps vaut
   * mieux qu'un enregistrement.
   */
  it('lit la reserve avant de reclamer le ticket', async () => {
    const b = banc(new TestStore([]));
    expect(await b.service.tryOpen(ticket(), 25_000)).toBe('skipped');
    expect(b.queue.claimed).toHaveLength(0);
  });

  it('renonce quand le ticket a deja ete reclame ailleurs', async () => {
    const b = banc();
    b.queue.claimable = false;
    expect(await b.service.tryOpen(ticket(), 25_000)).toBe('skipped');
    expect(b.opener.requests).toHaveLength(0);
  });

  /**
   * `failed` n'est pas un detail de vocabulaire : le ticket a quitte la file et
   * personne d'autre ne l'a. Sans ce retour, le joueur reste devant un ecran de
   * recherche que plus aucun tour n'alimente.
   */
  it('signale a l appelant qu un ticket reclame doit revenir en file', async () => {
    const b = banc();
    b.opener.result = null;
    expect(await b.service.tryOpen(ticket(), 25_000)).toBe('failed');
    expect(b.queue.claimed).toEqual(['p_seul']);
  });

  it('ne fait rien rater quand la reserve est injoignable', async () => {
    const store = new TestStore([recording()]);
    store.fail = true;
    const b = banc(store);
    expect(await b.service.tryOpen(ticket(), 25_000)).toBe('skipped');
    expect(b.queue.claimed).toHaveLength(0);
  });

  it('ne rejoue pas un enregistrement d une autre version des regles', async () => {
    const b = banc(new TestStore([recording({ rulesVersion: '0.0.1' })]));
    expect(await b.service.tryOpen(ticket(), 25_000)).toBe('skipped');
  });

  it('prend le rejeu en charge des que le match est ouvert', async () => {
    const b = banc();
    await b.service.tryOpen(ticket(), 25_000);
    const ghostPlayerId = b.opener.requests[0]!.playerB;
    expect(b.director.isDriving(ghostPlayerId)).toBe(true);
  });

  it('ne prend rien en charge quand le match ne s ouvre pas', async () => {
    const b = banc();
    b.opener.result = null;
    await b.service.tryOpen(ticket(), 25_000);
    expect(b.director.size).toBe(0);
  });

  /** Deux matchs contre le meme enregistrement ne doivent pas partager un siege. */
  it('donne un siege different a chaque rejeu du meme enregistrement', async () => {
    const b = banc();
    await b.service.tryOpen(ticket({ playerId: 'p_un' }), 25_000);
    await b.service.tryOpen(ticket({ playerId: 'p_deux' }), 25_000);
    expect(b.opener.requests[0]?.playerB).not.toBe(b.opener.requests[1]?.playerB);
  });
});
