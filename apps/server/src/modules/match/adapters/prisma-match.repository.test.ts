import { Writable } from 'node:stream';
import { Prisma } from '@prisma/client';
import { beforeEach, describe, expect, it } from 'vitest';
import { loadConfig } from '../../../shared/config.js';
import { createLogger, PinoLoggerService } from '../../../shared/logger.js';
import type { PrismaService } from '../../../shared/prisma.service.js';
import type { MatchRecord } from '../domain/ports.js';
import { matchEventsColumnSchema, PrismaMatchRepository } from './prisma-match.repository.js';

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
    rejectedEvents: { a: 3, b: 0 },
    droppedEvents: { a: 0, b: 0 },
    impossibleTaps: { a: 0, b: 0 },
    ...overrides,
  };
}

/** Journal volumineux, avec un marqueur reconnaissable dans la charge utile. */
const MARKER = 'contenu-de-manche-';
function aHugeJournal(entries = 40, bytesPerEntry = 10_000): MatchRecord['events'] {
  return Array.from({ length: entries }, (_, index) => ({
    atMs: STARTED_AT + index,
    event: { type: 'recharge:tap', index, payload: MARKER + 'x'.repeat(bytesPerEntry) },
  }));
}

/**
 * Plafond du journal ecrit, recopie de l'adaptateur.
 *
 * Le test ne verifie pas la valeur mais l'invariant : ce qui part en base tient
 * dessous. C'est la seule chose qui protege la transaction.
 */
const MAX_EVENTS_BYTES = 256 * 1024;

/** Colonne `events` telle qu'elle part en base. */
function eventsColumnOf(prisma: FakePrisma): {
  entries: { atMs: number; event: { index: number } }[];
  omittedEntries: number;
  counters: Record<string, Record<string, number>>;
} {
  const data = prisma.callsTo('match.create')[0]?.args.data as {
    events: {
      entries: { atMs: number; event: { index: number } }[];
      omittedEntries: number;
      counters: Record<string, Record<string, number>>;
    };
  };
  return data.events;
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
        counters: {
          A: { rejectedEvents: 3, droppedEvents: 0, impossibleTaps: 0 },
          B: { rejectedEvents: 0, droppedEvents: 0, impossibleTaps: 0 },
        },
        omittedEntries: 0,
      },
    });
  });

  /**
   * Les sanctions de docs/06 visent un joueur, pas un match. Un compteur
   * commun aux deux sieges attribuerait a un innocent les mensonges de son
   * adversaire : la separation par siege est la raison d'etre de ces chiffres.
   */
  it('garde les compteurs separes par siege, sans jamais les additionner', async () => {
    await repository.save(
      aRecord({
        rejectedEvents: { a: 12, b: 1 },
        droppedEvents: { a: 47, b: 2 },
        impossibleTaps: { a: 8, b: 0 },
      }),
    );

    expect(eventsColumnOf(prisma).counters).toEqual({
      A: { rejectedEvents: 12, droppedEvents: 47, impossibleTaps: 8 },
      B: { rejectedEvents: 1, droppedEvents: 2, impossibleTaps: 0 },
    });
  });

  /**
   * Les cles suivent l'enum Prisma (`A`/`B`), pas le vocabulaire du moteur :
   * c'est ce qui permet de rapprocher ces compteurs d'une ligne `MatchSeat`
   * sans table de conversion en tete.
   */
  it('nomme les sieges comme la colonne MatchSeat', async () => {
    await repository.save(aRecord());

    expect(Object.keys(eventsColumnOf(prisma).counters)).toEqual(['A', 'B']);
  });

  /**
   * Le signal « Latence » de docs/06 ne s'observe que sur la duree, match apres
   * match. Un compteur perdu avec le journal serait un signal aveugle.
   */
  it('conserve les compteurs meme quand le journal est tronque', async () => {
    await repository.save(aRecord({ events: aHugeJournal(), impossibleTaps: { a: 31, b: 0 } }));

    expect(eventsColumnOf(prisma).counters).toMatchObject({
      A: { impossibleTaps: 31, rejectedEvents: 3 },
      B: { impossibleTaps: 0 },
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

  /**
   * Un journal trop gros est **tronque**, pas jete : graine plus prefixe rejoue
   * le match jusqu'au point de coupure, graine plus rien ne rejoue rien. Le
   * seuil etant atteignable au debit legal, jeter offrirait a qui le veut un
   * moyen simple de faire disparaitre la trace de sa partie.
   */
  it('tronque un journal demesure au lieu de le jeter', async () => {
    await repository.save(aRecord({ events: aHugeJournal(), droppedEvents: { a: 9, b: 0 } }));

    const events = eventsColumnOf(prisma);
    expect(events.entries.length).toBeGreaterThan(0);
    expect(events.entries.length + events.omittedEntries).toBe(40);
    // La graine et les manches partent quand meme : c'est ce qui compte le plus.
    expect(prisma.callsTo('match.create')[0]?.args.data).toMatchObject({ seed: 'graine' });
    expect(prisma.callsTo('matchRound.createMany')[0]?.args.data).toHaveLength(2);
  });

  it('garde le debut du journal, dans l ordre', async () => {
    await repository.save(aRecord({ events: aHugeJournal() }));

    const gardees = eventsColumnOf(prisma).entries;
    expect(gardees.map((entry) => entry.event.index)).toEqual(
      Array.from({ length: gardees.length }, (_, index) => index),
    );
  });

  it('ecrit une colonne qui tient sous le plafond', async () => {
    await repository.save(aRecord({ events: aHugeJournal(200) }));

    const ecrit = JSON.stringify(eventsColumnOf(prisma));
    expect(Buffer.byteLength(ecrit)).toBeLessThanOrEqual(MAX_EVENTS_BYTES);
  });

  it('ecrit le journal entier quand il tient', async () => {
    await repository.save(aRecord());

    expect(eventsColumnOf(prisma).entries).toHaveLength(2);
    expect(eventsColumnOf(prisma).omittedEntries).toBe(0);
  });

  it('signale le journal tronque sans en recopier le contenu', async () => {
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

  /**
   * La colonne est un contrat persiste : ce qu'on ecrit doit etre exactement ce
   * qu'une lecture, dans six mois, saura interpreter.
   */
  it('ecrit une colonne conforme a son schema, journal entier comme journal tronque', async () => {
    await repository.save(aRecord());
    expect(matchEventsColumnSchema.safeParse(eventsColumnOf(prisma)).success).toBe(true);

    prisma.calls.length = 0;
    await repository.save(aRecord({ events: aHugeJournal() }));
    expect(matchEventsColumnSchema.safeParse(eventsColumnOf(prisma)).success).toBe(true);
  });

  it('refuse une enveloppe amputee d un siege', () => {
    const ampute = {
      entries: [],
      omittedEntries: 0,
      counters: { A: { rejectedEvents: 0, droppedEvents: 0, impossibleTaps: 0 } },
    };

    expect(matchEventsColumnSchema.safeParse(ampute).success).toBe(false);
  });

  it('refuse un compteur mal nomme', () => {
    const fauteDeFrappe = {
      entries: [],
      omittedEntries: 0,
      counters: {
        A: { rejectedEvent: 0, droppedEvents: 0, impossibleTaps: 0 },
        B: { rejectedEvents: 0, droppedEvents: 0, impossibleTaps: 0 },
      },
    };

    expect(matchEventsColumnSchema.safeParse(fauteDeFrappe).success).toBe(false);
  });

  it('refuse un compte de pertes negatif', () => {
    const impossible = {
      entries: [],
      omittedEntries: -1,
      counters: {
        A: { rejectedEvents: 0, droppedEvents: 0, impossibleTaps: 0 },
        B: { rejectedEvents: 0, droppedEvents: 0, impossibleTaps: 0 },
      },
    };

    expect(matchEventsColumnSchema.safeParse(impossible).success).toBe(false);
  });

  /**
   * Cas inatteignable aujourd'hui — les compteurs viennent d'un type `number`.
   * Il fixe le sens de la chute : une enveloppe qu'on ne sait pas ecrire
   * n'emporte ni la graine, ni les sieges, ni les manches.
   */
  it('ecrit une colonne nulle plutot qu une enveloppe qu elle ne sait pas decrire', async () => {
    const compteurAbsurde = { a: 1n as unknown as number, b: 0 };

    await repository.save(aRecord({ rejectedEvents: compteurAbsurde }));

    const data = prisma.callsTo('match.create')[0]?.args.data as { events: unknown };
    expect(data.events).toBe(Prisma.JsonNull);
    expect(prisma.callsTo('matchRound.createMany')[0]?.args.data).toHaveLength(2);
    const sortie = lines.join('');
    expect(sortie).toContain('m_1');
    expect(sortie).toContain('counters.A.rejectedEvents');
    expect(sortie).not.toContain('graine');
  });

  it('garde ce qui precede une entree non serialisable', async () => {
    const boucle: { self?: unknown } = {};
    boucle.self = boucle;
    const journal = [...aHugeJournal(2, 10), { atMs: STARTED_AT + 2, event: boucle }];

    await repository.save(aRecord({ events: journal }));

    const events = eventsColumnOf(prisma);
    expect(events.entries).toHaveLength(2);
    expect(events.omittedEntries).toBe(1);
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
