import { Writable } from 'node:stream';
import type { Prisma } from '@prisma/client';
import { beforeEach, describe, expect, it } from 'vitest';
import { loadConfig } from '../../../shared/config.js';
import { createLogger, PinoLoggerService } from '../../../shared/logger.js';
import type { PrismaService } from '../../../shared/prisma.service.js';
import type { MatchRecord } from '../domain/ports.js';
import { PrismaMatchRepository } from './prisma-match.repository.js';

/**
 * L'adaptateur se teste sans base de donnees : ce qui compte ici n'est pas que
 * Postgres accepte les lignes, c'est **ce qu'on lui demande d'ecrire** — la
 * conversion des sieges, les horodatages, et le fait que les quatre ecritures
 * partent ensemble ou pas du tout.
 */

interface RecordedCall {
  readonly target: string;
  readonly args: { data: unknown };
}

/**
 * Double de `PrismaService`.
 *
 * Seul `$transaction` expose des modeles : toucher `prisma.match` directement
 * leve. C'est volontaire — un adaptateur qui ecrirait hors transaction doit
 * faire echouer le test, pas passer inapercu.
 */
class FakePrisma {
  readonly calls: RecordedCall[] = [];
  transactions = 0;
  /** Options recues par la derniere transaction. */
  transactionOptions: { maxWait?: number; timeout?: number } | undefined;
  /** Cible (`modele.methode`) dont l'ecriture doit echouer, pour le cas d'erreur. */
  failOn: string | null = null;
  /** Erreur levee a la place de la banale `base indisponible`. */
  failWith: Error | null = null;

  get match(): never {
    throw new Error('ecriture hors transaction');
  }

  get matchSeat(): never {
    throw new Error('ecriture hors transaction');
  }

  get matchRound(): never {
    throw new Error('ecriture hors transaction');
  }

  $transaction<T>(
    run: (tx: Prisma.TransactionClient) => Promise<T>,
    options?: { maxWait?: number; timeout?: number },
  ): Promise<T> {
    this.transactions += 1;
    this.transactionOptions = options;
    return run(this.transactionClient());
  }

  /** Vue des appels d'un modele donne, dans l'ordre. */
  callsTo(target: string): RecordedCall[] {
    return this.calls.filter((call) => call.target === target);
  }

  asService(): PrismaService {
    return this as unknown as PrismaService;
  }

  private transactionClient(): Prisma.TransactionClient {
    const record =
      (target: string) =>
      (args: { data: unknown }): Promise<unknown> => {
        this.calls.push({ target, args });
        return this.failOn === target
          ? Promise.reject(this.failWith ?? new Error('base indisponible'))
          : Promise.resolve({});
      };
    return {
      match: { create: record('match.create') },
      matchSeat: { createMany: record('matchSeat.createMany') },
      matchRound: { createMany: record('matchRound.createMany') },
    } as unknown as Prisma.TransactionClient;
  }
}

const config = loadConfig({
  DATABASE_URL: 'postgresql://aura:aura@localhost:5432/aura',
  REDIS_URL: 'redis://localhost:6379',
  JWT_SECRET: 'un-secret-assez-long',
  NODE_ENV: 'test',
});

/** Capture les lignes ecrites par le logger. */
function capture(): { lines: string[]; logger: PinoLoggerService } {
  const lines: string[] = [];
  const stream = new Writable({
    write(chunk: Buffer, _encoding, callback) {
      lines.push(chunk.toString());
      callback();
    },
  });
  return { lines, logger: new PinoLoggerService(createLogger(config, stream)) };
}

const STARTED_AT = Date.UTC(2026, 8, 16, 12, 0, 0);

function aRecord(overrides: Partial<MatchRecord> = {}): MatchRecord {
  return {
    matchId: 'm_1',
    seed: 'graine',
    mode: 'RANKED',
    rulesVersion: '1.2.3',
    contentVersion: '4.5.6',
    seats: { a: 'p_alice', b: 'p_bob' },
    winner: 'a',
    reason: 'rounds',
    startedAtMs: STARTED_AT,
    endedAtMs: STARTED_AT + 90_000,
    rounds: [
      { round: 1, result: { winner: 'a', scores: { a: 12, b: 7 } } },
      { round: 2, result: { winner: 'a', scores: { a: 15, b: 9 } } },
    ],
    events: [
      { atMs: STARTED_AT + 10, event: { type: 'recharge:tap', seat: 'a' } },
      { atMs: STARTED_AT + 20, event: { type: 'choice:lock', seat: 'b' } },
    ],
    rejectedEvents: 3,
    droppedEvents: 0,
    impossibleTaps: 0,
    ...overrides,
  };
}

/** Journal volumineux, avec un marqueur reconnaissable dans la charge utile. */
const MARKER = 'contenu-de-manche-';
function aHugeJournal(entries = 40, bytesPerEntry = 10_000): MatchRecord['events'] {
  return Array.from({ length: entries }, (_, index) => ({
    atMs: STARTED_AT + index,
    event: { type: 'recharge:tap', payload: MARKER + 'x'.repeat(bytesPerEntry) },
  }));
}

describe('PrismaMatchRepository', () => {
  let prisma: FakePrisma;
  let lines: string[];
  let repository: PrismaMatchRepository;

  beforeEach(() => {
    prisma = new FakePrisma();
    const captured = capture();
    lines = captured.lines;
    repository = new PrismaMatchRepository(prisma.asService(), captured.logger);
  });

  it('ecrit le match, ses sieges et ses manches dans une seule transaction', async () => {
    await repository.save(aRecord());

    expect(prisma.transactions).toBe(1);
    expect(prisma.calls.map((call) => call.target)).toEqual([
      'match.create',
      'matchSeat.createMany',
      'matchRound.createMany',
    ]);
  });

  it('enregistre le match acheve avec sa graine et ses versions', async () => {
    await repository.save(aRecord());

    expect(prisma.callsTo('match.create')[0]?.args.data).toEqual({
      id: 'm_1',
      mode: 'RANKED',
      rulesVersion: '1.2.3',
      contentVersion: '4.5.6',
      seed: 'graine',
      status: 'ENDED',
      endReason: 'rounds',
      winnerSeat: 'A',
      startedAt: new Date(STARTED_AT),
      endedAt: new Date(STARTED_AT + 90_000),
      events: {
        entries: [
          { atMs: STARTED_AT + 10, event: { type: 'recharge:tap', seat: 'a' } },
          { atMs: STARTED_AT + 20, event: { type: 'choice:lock', seat: 'b' } },
        ],
        rejectedEvents: 3,
        droppedEvents: 0,
        impossibleTaps: 0,
        omittedEntries: 0,
      },
    });
  });

  it('conserve les compteurs d evenements refuses, ecartes et impossibles', async () => {
    await repository.save(aRecord({ rejectedEvents: 12, droppedEvents: 47, impossibleTaps: 8 }));

    expect(prisma.callsTo('match.create')[0]?.args.data).toMatchObject({
      events: { rejectedEvents: 12, droppedEvents: 47, impossibleTaps: 8 },
    });
  });

  /**
   * Le signal « Latence » de docs/06 ne s'observe que sur la duree, match apres
   * match. Un compteur perdu avec le journal serait un signal aveugle.
   */
  it('conserve les compteurs meme quand le journal est ecarte', async () => {
    await repository.save(aRecord({ events: aHugeJournal(), impossibleTaps: 31 }));

    expect(prisma.callsTo('match.create')[0]?.args.data).toMatchObject({
      events: { entries: [], impossibleTaps: 31, rejectedEvents: 3 },
    });
  });

  it('borne l attente et la duree de la transaction', async () => {
    await repository.save(aRecord());

    expect(prisma.transactionOptions?.maxWait).toBeGreaterThan(0);
    expect(prisma.transactionOptions?.timeout).toBeGreaterThan(
      prisma.transactionOptions?.maxWait ?? 0,
    );
  });

  it('convertit les sieges du moteur en enum Prisma', async () => {
    await repository.save(aRecord());

    expect(prisma.callsTo('matchSeat.createMany')[0]?.args.data).toEqual([
      { matchId: 'm_1', seat: 'A', playerId: 'p_alice' },
      { matchId: 'm_1', seat: 'B', playerId: 'p_bob' },
    ]);
  });

  it('convertit le siege vainqueur, siege b compris', async () => {
    await repository.save(aRecord({ winner: 'b' }));

    expect(prisma.callsTo('match.create')[0]?.args.data).toMatchObject({ winnerSeat: 'B' });
  });

  it('accepte un match sans vainqueur', async () => {
    await repository.save(aRecord({ winner: null, reason: 'aborted' }));

    expect(prisma.callsTo('match.create')[0]?.args.data).toMatchObject({
      winnerSeat: null,
      endReason: 'aborted',
    });
  });

  it('accepte un siege sans joueur (fantome)', async () => {
    await repository.save(aRecord({ seats: { a: 'p_alice', b: null } }));

    expect(prisma.callsTo('matchSeat.createMany')[0]?.args.data).toEqual([
      { matchId: 'm_1', seat: 'A', playerId: 'p_alice' },
      { matchId: 'm_1', seat: 'B', playerId: null },
    ]);
  });

  it('ecrit une ligne par manche, resultat tel quel', async () => {
    await repository.save(aRecord());

    expect(prisma.callsTo('matchRound.createMany')[0]?.args.data).toEqual([
      { matchId: 'm_1', round: 1, result: { winner: 'a', scores: { a: 12, b: 7 } } },
      { matchId: 'm_1', round: 2, result: { winner: 'a', scores: { a: 15, b: 9 } } },
    ]);
  });

  it('enregistre un match abandonne avant la premiere manche, sans requete de manche', async () => {
    await repository.save(aRecord({ rounds: [], winner: 'b', reason: 'forfeit' }));

    expect(prisma.transactions).toBe(1);
    expect(prisma.calls.map((call) => call.target)).toEqual([
      'match.create',
      'matchSeat.createMany',
    ]);
    expect(prisma.callsTo('match.create')[0]?.args.data).toMatchObject({
      endReason: 'forfeit',
      winnerSeat: 'B',
    });
  });

  it('ecrit le match sans son journal quand celui-ci est demesure', async () => {
    await repository.save(aRecord({ events: aHugeJournal(), droppedEvents: 9 }));

    // La graine et les manches partent quand meme : c'est ce qui compte le plus.
    expect(prisma.callsTo('match.create')[0]?.args.data).toMatchObject({
      seed: 'graine',
      events: {
        entries: [],
        rejectedEvents: 3,
        droppedEvents: 9,
        impossibleTaps: 0,
        omittedEntries: 40,
      },
    });
    expect(prisma.callsTo('matchRound.createMany')[0]?.args.data).toHaveLength(2);
  });

  it('signale le journal ecarte sans en recopier le contenu', async () => {
    await repository.save(aRecord({ events: aHugeJournal() }));

    const sortie = lines.join('');
    expect(sortie).toContain('m_1');
    expect(sortie).not.toContain(MARKER);
  });

  it('ecrit le match meme si le journal n est pas serialisable', async () => {
    const boucle: { self?: unknown } = {};
    boucle.self = boucle;

    await repository.save(aRecord({ events: [{ atMs: STARTED_AT, event: boucle }] }));

    expect(prisma.callsTo('match.create')[0]?.args.data).toMatchObject({
      events: { entries: [], omittedEntries: 1 },
    });
  });

  it('journalise puis propage un echec d ecriture', async () => {
    prisma.failOn = 'matchRound.createMany';

    await expect(repository.save(aRecord())).rejects.toThrow('base indisponible');

    const sortie = lines.join('');
    expect(sortie).toContain('m_1');
    expect(sortie).toContain('base indisponible');
  });

  it('ne recopie pas l etat du match dans le journal d erreur', async () => {
    prisma.failOn = 'match.create';

    await expect(repository.save(aRecord())).rejects.toThrow();

    // Regle d'or n°4 : un journal est lu par bien plus de monde qu'une base.
    expect(lines.join('')).not.toContain('graine');
  });

  /**
   * Une `PrismaClientValidationError` recopie les arguments fautifs dans son
   * message et sa pile — donc la graine et le journal, en clair. On ne garde
   * que le nom et la premiere ligne, tronquee.
   */
  it('ne recopie ni la pile ni le detail des arguments d une erreur de validation', async () => {
    const validation = new Error(
      "Invalid `prisma.match.create()` invocation\n{ data: { seed: 'graine', events: [ { event: { choice: 'ultimate' } } ] } }",
    );
    validation.name = 'PrismaClientValidationError';
    prisma.failOn = 'match.create';
    prisma.failWith = validation;

    await expect(repository.save(aRecord())).rejects.toThrow();

    const sortie = lines.join('');
    expect(sortie).toContain('PrismaClientValidationError');
    expect(sortie).toContain('m_1');
    expect(sortie).not.toContain('graine');
    expect(sortie).not.toContain('ultimate');
    // Le vidage d'arguments commence a la deuxieme ligne : elle ne doit pas suivre.
    expect(sortie).not.toContain('{ data:');
  });

  it('borne la cause journalisee d une erreur bavarde', async () => {
    const bavarde = new Error('x'.repeat(5_000));
    prisma.failOn = 'match.create';
    prisma.failWith = bavarde;

    await expect(repository.save(aRecord())).rejects.toThrow();

    expect(lines.join('')).not.toContain('x'.repeat(500));
  });
});
