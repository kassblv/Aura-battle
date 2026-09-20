import type { ServerMessage, ServerMessageName } from '@aura/protocol';
import { PROTOCOL_VERSION } from '@aura/protocol';
import { beforeEach, describe, expect, it } from 'vitest';
import { UNKNOWN_PLAYER_NAME, type PlayerDirectory } from '../domain/directory.js';
import type { MatchNotifier } from '../domain/ports.js';
import {
  MatchOpener,
  type MatchStarter,
  type PlayerPresence,
  type QueueEviction,
} from './match-opener.js';
import type { MatchSeats } from './match-runtime.js';

/**
 * Chemin unique d'ouverture : invitation et file d'attente passent par ici.
 *
 * Ce qui est verifie n'est pas du confort. Chaque joueur doit recevoir le nom
 * de l'AUTRE — le bug a deja ete commis, les deux voyaient « Adversaire ». Un
 * joueur qui commence un match doit quitter la file — sinon le worker le
 * rapparie et son second adversaire heritera d'un forfait. Et rien ne doit
 * etre annonce si les sieges ne sont pas libres.
 */

class RecordingNotifier implements MatchNotifier {
  readonly sent: { playerId: string; name: string; payload: unknown }[] = [];

  send<N extends ServerMessageName>(playerId: string, name: N, payload: ServerMessage<N>): void {
    this.sent.push({ playerId, name, payload });
  }

  foundBy(playerId: string): ServerMessage<'match:found'> | undefined {
    return this.sent.find((m) => m.playerId === playerId && m.name === 'match:found')?.payload as
      ServerMessage<'match:found'> | undefined;
  }
}

class FakeRuntime implements MatchStarter {
  readonly opened: {
    matchId: string;
    seats: MatchSeats;
    mode: string | undefined;
    /** Messages deja partis au moment de l'ouverture : l'ordre compte. */
    sentBefore: number;
  }[] = [];
  readonly abandonArmed: string[] = [];
  busy = new Set<string>();
  refuse = false;

  constructor(private readonly notifier: RecordingNotifier) {}

  isBusy(playerId: string): boolean {
    return this.busy.has(playerId);
  }

  createMatch(input: {
    matchId: string;
    seed: string;
    seats: MatchSeats;
    mode?: 'RANKED' | 'CASUAL' | 'INVITE';
  }): boolean {
    if (this.refuse) return false;
    this.opened.push({
      matchId: input.matchId,
      seats: input.seats,
      mode: input.mode,
      sentBefore: this.notifier.sent.length,
    });
    return true;
  }

  notePlayerDisconnected(playerId: string): void {
    this.abandonArmed.push(playerId);
  }
}

/** Presence : tout le monde est connecte, sauf ce qu'on retire. */
class FakePresence implements PlayerPresence {
  readonly absent = new Set<string>();

  isConnected(playerId: string): boolean {
    return !this.absent.has(playerId);
  }
}

class FakeDirectory implements PlayerDirectory {
  failure: Error | null = null;

  displayNames(playerIds: readonly string[]): Promise<ReadonlyMap<string, string>> {
    if (this.failure !== null) return Promise.reject(this.failure);
    return Promise.resolve(new Map(playerIds.map((id) => [id, `Nom de ${id}`])));
  }
}

class FakeQueue implements QueueEviction {
  readonly evicted: string[] = [];
  failure: Error | null = null;

  leave(playerId: string): Promise<void> {
    this.evicted.push(playerId);
    return this.failure === null ? Promise.resolve() : Promise.reject(this.failure);
  }
}

let notifier: RecordingNotifier;
let runtime: FakeRuntime;
let presence: FakePresence;
let directory: FakeDirectory;
let queue: FakeQueue;
let opener: MatchOpener;

beforeEach(() => {
  notifier = new RecordingNotifier();
  runtime = new FakeRuntime(notifier);
  presence = new FakePresence();
  directory = new FakeDirectory();
  queue = new FakeQueue();
  opener = new MatchOpener(runtime, notifier, presence, directory, queue);
});

const open = (mode: 'RANKED' | 'CASUAL' | 'INVITE' = 'RANKED'): Promise<string | null> =>
  opener.open({ playerA: 'p1', playerB: 'p2', mode });

describe('MatchOpener', () => {
  it('assoit les deux joueurs a des places differentes dans le meme match', async () => {
    const matchId = await open();

    expect(matchId).not.toBeNull();
    expect(notifier.foundBy('p1')?.matchId).toBe(matchId);
    expect(notifier.foundBy('p2')?.matchId).toBe(matchId);
    expect(notifier.foundBy('p1')?.seat).not.toBe(notifier.foundBy('p2')?.seat);
    expect(runtime.opened).toHaveLength(1);
  });

  it('annonce a chaque joueur le nom de son ADVERSAIRE', async () => {
    await open();

    expect(notifier.foundBy('p1')?.opponent.displayName).toBe('Nom de p2');
    expect(notifier.foundBy('p2')?.opponent.displayName).toBe('Nom de p1');
  });

  /** Un nom manquant ne vaut pas un duel annule. */
  it('ouvre quand meme si l annuaire ne repond pas', async () => {
    directory.failure = new Error('base injoignable');

    expect(await open()).not.toBeNull();
    expect(notifier.foundBy('p1')?.opponent.displayName).toBe(UNKNOWN_PLAYER_NAME);
  });

  it('annonce les versions du protocole, des regles et du contenu', async () => {
    await open();
    const found = notifier.foundBy('p1');

    expect(found?.protocolVersion).toBe(PROTOCOL_VERSION);
    expect(found?.rulesVersion).not.toBe('');
    expect(found?.ghost).toBe(false);
  });

  it('sort les deux joueurs de la file avant d ouvrir', async () => {
    await open();
    expect(queue.evicted.sort()).toEqual(['p1', 'p2']);
  });

  it('ouvre quand meme si la file ne repond pas', async () => {
    queue.failure = new Error('Redis injoignable');
    expect(await open()).not.toBeNull();
  });

  it('conserve le mode d ouverture pour l enregistrement', async () => {
    await open('CASUAL');
    expect(runtime.opened[0]?.mode).toBe('CASUAL');
  });

  /**
   * Le cas qui fait le plus de degats : annoncer un match a quelqu'un qui joue
   * deja. Son client bascule sur une arene dont le serveur ne sait rien, et il
   * perd la partie en cours.
   */
  it('n annonce rien quand un joueur occupe deja un siege', async () => {
    runtime.busy.add('p2');

    expect(await open()).toBeNull();
    expect(notifier.sent).toHaveLength(0);
    expect(runtime.opened).toHaveLength(0);
  });

  /**
   * `createMatch` annonce la premiere manche sur-le-champ : un `round:intro`
   * qui precederait `match:found` porterait un `matchId` inconnu du client.
   */
  it('annonce le match avant de l ouvrir', async () => {
    await open();
    expect(runtime.opened[0]?.sentBefore).toBe(2);
  });

  /**
   * Un joueur peut fermer sa socket pendant la lecture des noms. Si son
   * `disconnect` est passe avant l'existence du match, plus rien n'armerait
   * l'abandon et son adversaire subirait trois manches d'actions par defaut.
   */
  it('arme l abandon d un joueur deja parti a l ouverture', async () => {
    presence.absent.add('p2');

    await open();

    expect(runtime.abandonArmed).toEqual(['p2']);
  });

  it('n arme rien quand les deux joueurs sont la', async () => {
    await open();
    expect(runtime.abandonArmed).toEqual([]);
  });

  it('signale un refus d ouverture survenu apres l annonce', async () => {
    const warnings: string[] = [];
    opener = new MatchOpener(runtime, notifier, presence, directory, queue, {
      warn: (message: string) => warnings.push(message),
    });
    runtime.refuse = true;

    expect(await open()).toBeNull();
    expect(warnings).toHaveLength(1);
  });
});
