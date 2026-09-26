import { CHALLENGES_PER_DAY, challengesForDay, dayIndexOf } from '@aura/content';
import { beforeEach, describe, expect, it } from 'vitest';
import type { ChallengeRepository, Clock } from '../domain/ports.js';
import type { StoredProgress } from '../domain/progress.js';
import { emptyContribution } from '../domain/progress.js';
import { ChallengeService } from './challenges.js';

const AT = Date.parse('2026-09-22T10:00:00Z');
const DAY = dayIndexOf(AT);

class MemoryRepository implements ChallengeRepository {
  readonly rows = new Map<string, StoredProgress>();
  readonly credited: { playerId: string; reward: number }[] = [];
  /** Simule un second onglet qui encaisse entre la lecture et l'ecriture. */
  stolen = false;

  private key(playerId: string, day: number, challengeId: string): string {
    return `${playerId}|${String(day)}|${challengeId}`;
  }

  read(playerId: string, day: number): Promise<readonly StoredProgress[]> {
    const prefix = `${playerId}|${String(day)}|`;
    return Promise.resolve(
      [...this.rows.entries()].filter(([key]) => key.startsWith(prefix)).map(([, row]) => row),
    );
  }

  write(
    playerId: string,
    day: number,
    entries: readonly { challengeId: string; progress: number }[],
  ): Promise<void> {
    for (const entry of entries) {
      const key = this.key(playerId, day, entry.challengeId);
      const before = this.rows.get(key);
      this.rows.set(key, {
        challengeId: entry.challengeId,
        progress: entry.progress,
        claimed: before?.claimed ?? false,
      });
    }
    return Promise.resolve();
  }

  claim(playerId: string, day: number, challengeId: string, reward: number): Promise<boolean> {
    if (this.stolen) return Promise.resolve(false);
    const key = this.key(playerId, day, challengeId);
    const row = this.rows.get(key);
    if (row === undefined || row.claimed) return Promise.resolve(false);
    this.rows.set(key, { ...row, claimed: true });
    this.credited.push({ playerId, reward });
    return Promise.resolve(true);
  }
}

const clock: Clock = { now: () => new Date(AT) };

let repository: MemoryRepository;
let service: ChallengeService;

beforeEach(() => {
  repository = new MemoryRepository();
  service = new ChallengeService({ challenges: repository, clock });
});

describe('today', () => {
  it('rend les defis du jour, tous a zero pour un nouveau joueur', async () => {
    const today = await service.today('joueur');
    expect(today).toHaveLength(CHALLENGES_PER_DAY);
    for (const entry of today) {
      expect(entry.progress).toBe(0);
      expect(entry.claimed).toBe(false);
      expect(entry.done).toBe(false);
    }
  });

  /*
    La progression d'hier n'apparait pas aujourd'hui. C'est le decoupage
    quotidien lui-meme : sans cette lecture par jour, un joueur ouvrirait le
    jeu le lendemain avec ses trois defis deja remplis.
  */
  it('ignore la progression d un autre jour', async () => {
    const first = challengesForDay(DAY)[0];
    await repository.write('joueur', DAY - 1, [{ challengeId: first?.id ?? '', progress: 999 }]);
    const today = await service.today('joueur');
    expect(today.every((entry) => entry.progress === 0)).toBe(true);
  });

  it('marque termine ce qui a atteint sa cible', async () => {
    const first = challengesForDay(DAY)[0];
    await repository.write('joueur', DAY, [
      { challengeId: first?.id ?? '', progress: first?.target ?? 0 },
    ]);
    const entry = (await service.today('joueur')).find((c) => c.id === first?.id);
    expect(entry?.done).toBe(true);
    expect(entry?.claimed).toBe(false);
  });
});

describe('recordMatch', () => {
  it('avance les defis que la partie a servis', async () => {
    const day = challengesForDay(DAY);
    const wins = day.find((challenge) => challenge.metric === 'wins');
    if (wins === undefined) return;

    await service.recordMatch('joueur', { ...emptyContribution(), wins: 1 });
    const entry = (await service.today('joueur')).find((c) => c.id === wins.id);
    expect(entry?.progress).toBe(1);
  });

  /*
    Une partie qui ne sert aucun defi du jour n'ecrit rien. Sans ce filtre, on
    creerait trois lignes a zero pour chaque match de chaque joueur — une
    table qui grossit de tout ce qui ne s'est pas passe.
  */
  it('n ecrit rien quand la partie ne sert aucun defi', async () => {
    await service.recordMatch('joueur', emptyContribution());
    expect(repository.rows.size).toBe(0);
  });

  it('cumule d une partie a l autre', async () => {
    const day = challengesForDay(DAY);
    const counters = day.find((challenge) => challenge.metric === 'counters');
    if (counters === undefined) return;

    await service.recordMatch('joueur', { ...emptyContribution(), counters: 1 });
    await service.recordMatch('joueur', { ...emptyContribution(), counters: 1 });
    const entry = (await service.today('joueur')).find((c) => c.id === counters.id);
    expect(entry?.progress).toBe(2);
  });
});

describe('claim', () => {
  const finish = async (metric: string): Promise<string | null> => {
    const challenge = challengesForDay(DAY).find((c) => c.metric === metric);
    if (challenge === undefined) return null;
    await repository.write('joueur', DAY, [
      { challengeId: challenge.id, progress: challenge.target },
    ]);
    return challenge.id;
  };

  it('paie un defi termine', async () => {
    const id = await finish(challengesForDay(DAY)[0]?.metric ?? 'wins');
    if (id === null) return;
    const result = await service.claim('joueur', id);
    expect(result.status).toBe('granted');
    expect(repository.credited).toHaveLength(1);
  });

  it('refuse deux fois le meme defi', async () => {
    const id = await finish(challengesForDay(DAY)[0]?.metric ?? 'wins');
    if (id === null) return;
    await service.claim('joueur', id);
    expect((await service.claim('joueur', id)).status).toBe('already-claimed');
    expect(repository.credited).toHaveLength(1);
  });

  /*
    La course : deux onglets terminent la lecture avant que l'un des deux
    n'ecrive. La regle pure dit « accorde » aux deux ; c'est la base qui
    tranche, et le service doit CROIRE son refus plutot que de croire sa
    propre lecture.
  */
  it('cede a la base quand elle dit que c est deja encaisse', async () => {
    const id = await finish(challengesForDay(DAY)[0]?.metric ?? 'wins');
    if (id === null) return;
    repository.stolen = true;
    expect((await service.claim('joueur', id)).status).toBe('already-claimed');
    expect(repository.credited).toHaveLength(0);
  });

  it('refuse un defi non termine', async () => {
    const id = challengesForDay(DAY)[0]?.id ?? '';
    expect((await service.claim('joueur', id)).status).toBe('incomplete');
    expect(repository.credited).toHaveLength(0);
  });

  it('refuse un defi qui n est pas de la journee', async () => {
    expect((await service.claim('joueur', 'challenge.inexistant')).status).toBe('unknown');
  });
});
