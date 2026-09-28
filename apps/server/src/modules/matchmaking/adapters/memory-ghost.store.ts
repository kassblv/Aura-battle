import { randomUUID } from 'node:crypto';
import type { GhostRecording, GhostRound } from '../domain/ghost.js';
import type { GhostRecordingStore } from '../domain/ports.js';

/**
 * Reserve d'enregistrements en memoire de processus.
 *
 * Double de test, et rien d'autre : la reserve de fantomes doit survivre a un
 * redemarrage et se partager entre instances, ce qu'un objet de processus ne
 * fait ni l'un ni l'autre. Elle applique les memes deux regles que
 * l'adaptateur Prisma — une ligne par joueur, une fourchette de MMR a la
 * lecture — pour qu'un test ne prouve pas autre chose que la production.
 */
export class MemoryGhostStore implements GhostRecordingStore {
  /** Par joueur : son dernier enregistrement. */
  private readonly byPlayer = new Map<string, GhostRecording & { createdAtMs: number }>();

  candidates(query: {
    readonly rulesVersion: string;
    readonly mmr: number;
    readonly range: number;
    readonly limit: number;
  }): Promise<readonly GhostRecording[]> {
    const matching = [...this.byPlayer.values()]
      .filter(
        (recording) =>
          recording.rulesVersion === query.rulesVersion &&
          Math.abs(recording.mmr - query.mmr) <= query.range,
      )
      .sort((left, right) => right.createdAtMs - left.createdAtMs)
      .slice(0, query.limit);

    return Promise.resolve(matching);
  }

  save(recording: {
    readonly playerId: string;
    readonly mmr: number;
    readonly rulesVersion: string;
    readonly rounds: readonly GhostRound[];
    readonly atMs: number;
  }): Promise<void> {
    // `set` sur une cle existante remplace : un enregistrement par joueur.
    this.byPlayer.set(recording.playerId, {
      id: `ghost_${randomUUID()}`,
      playerId: recording.playerId,
      mmr: recording.mmr,
      rulesVersion: recording.rulesVersion,
      rounds: recording.rounds,
      createdAtMs: recording.atMs,
    });
    return Promise.resolve();
  }

  /** Nombre d'enregistrements retenus. Sert aux tests, pas au jeu. */
  get size(): number {
    return this.byPlayer.size;
  }
}
