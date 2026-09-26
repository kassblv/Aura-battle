import { Writable } from 'node:stream';
import { Prisma } from '@prisma/client';
import { beforeEach, describe, expect, it } from 'vitest';
import { loadConfig } from '../../../shared/config.js';
import { DATABASE_TIMEOUTS } from '../../../shared/database-timeouts.js';
import { createLogger, PinoLoggerService } from '../../../shared/logger.js';
import { MessageMetrics } from '../../../shared/metrics.js';
import type { PrismaService } from '../../../shared/prisma.service.js';
import type { MatchRecord } from '../domain/ports.js';
import {
  matchEventsColumnSchema,
  PrismaMatchRepository,
  TRANSACTION_OPTIONS,
} from './prisma-match.repository.js';

/**
 * L'adaptateur se teste sans base de donnees : ce qui compte ici n'est pas que
 * Postgres accepte les lignes, c'est **ce qu'on lui demande d'ecrire** — la
 * conversion des sieges, les horodatages, et le fait que les quatre ecritures
 * partent ensemble ou pas du tout.
 */

interface RecordedCall {
  readonly target: string;
  readonly args: { data?: unknown; where?: unknown };
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
  /** Joueurs presents en base, pour la verification d'attribution des sieges. */
  readonly players = new Set<string>(['p_alice', 'p_bob']);

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
    /**
     * `$queryRaw` est appele comme un gabarit tague : on reconstitue le SQL
     * pour pouvoir affirmer le mode de verrou, et on traite les valeurs
     * interpolees comme les identifiants demandes.
     */
    const queryRaw = (
      strings: TemplateStringsArray,
      ...values: unknown[]
    ): Promise<{ id: string }[]> => {
      const sql = strings.join('?');
      const asked = values.flatMap((value) =>
        value !== null && typeof value === 'object' && 'values' in value
          ? ((value as { values: unknown[] }).values as string[])
          : [String(value)],
      );
      this.calls.push({ target: '$queryRaw', args: { where: { sql, asked } } });
      return Promise.resolve(asked.filter((id) => this.players.has(id)).map((id) => ({ id })));
    };
    return {
      match: { create: record('match.create') },
      matchSeat: { createMany: record('matchSeat.createMany') },
      matchRound: { createMany: record('matchRound.createMany') },
      $queryRaw: queryRaw,
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
    ghost: null,
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
    queueWaitMs: { a: null, b: null },
    intentBubble: false,
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
  let metrics: MessageMetrics;

  beforeEach(() => {
    prisma = new FakePrisma();
    const captured = capture();
    lines = captured.lines;
    metrics = new MessageMetrics(true);
    repository = new PrismaMatchRepository(prisma.asService(), captured.logger, metrics);
  });

  it('ecrit le match, ses sieges et ses manches dans une seule transaction', async () => {
    await repository.save(aRecord());

    expect(prisma.transactions).toBe(1);
    expect(prisma.calls.map((call) => call.target)).toEqual([
      'match.create',
      '$queryRaw',
      'matchSeat.createMany',
      'matchRound.createMany',
    ]);
  });

  it('enregistre le match acheve avec sa graine et ses versions', async () => {
    await repository.save(aRecord());

    expect(prisma.callsTo('match.create')[0]?.args.data).toEqual({
      id: 'm_1',
      mode: 'RANKED',
      isGhost: false,
      intentBubble: false,
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
      { matchId: 'm_1', seat: 'A', playerId: 'p_alice', ghostOfId: null, queueWaitMs: null },
      { matchId: 'm_1', seat: 'B', playerId: 'p_bob', ghostOfId: null, queueWaitMs: null },
    ]);
  });

  /**
   * L'attente en file de chaque siege (indicateurs produit, docs/00) : le
   * serveur la connait a l'appariement et nulle part ailleurs.
   */
  it('ecrit l attente en file de chaque siege, nulle pour qui n a pas fait la queue', async () => {
    await repository.save(aRecord({ queueWaitMs: { a: 4_200, b: null } }));

    expect(prisma.callsTo('matchSeat.createMany')[0]?.args.data).toEqual([
      { matchId: 'm_1', seat: 'A', playerId: 'p_alice', ghostOfId: null, queueWaitMs: 4_200 },
      { matchId: 'm_1', seat: 'B', playerId: 'p_bob', ghostOfId: null, queueWaitMs: null },
    ]);
  });

  /** Test A/B de la bulle d'intention (spec 2026-09-26) : on sait quels matchs l'avaient. */
  it('ecrit si la bulle d intention etait active', async () => {
    await repository.save(aRecord({ mode: 'CASUAL', intentBubble: true }));

    expect(prisma.callsTo('match.create')[0]?.args.data).toMatchObject({ intentBubble: true });
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
      { matchId: 'm_1', seat: 'A', playerId: 'p_alice', ghostOfId: null, queueWaitMs: null },
      { matchId: 'm_1', seat: 'B', playerId: null, ghostOfId: null, queueWaitMs: null },
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
      '$queryRaw',
      'matchSeat.createMany',
    ]);
    expect(prisma.callsTo('match.create')[0]?.args.data).toMatchObject({
      endReason: 'forfeit',
      winnerSeat: 'B',
    });
  });

  /**
   * Un joueur peut avoir disparu entre le debut du match et son ecriture :
   * compte supprime, purge RGPD, incident. La cle etrangere ferait alors
   * echouer toute la transaction — on perdrait la graine, les manches et le
   * journal pour une attribution. `docs/06` veut un journal de litige, pas un
   * nom : le siege part sans joueur, et la perte est tracee.
   */
  it('ecrit un siege sans joueur plutot que de perdre le match', async () => {
    prisma.players.delete('p_bob');

    await repository.save(aRecord());

    expect(prisma.callsTo('matchSeat.createMany')[0]?.args.data).toEqual([
      { matchId: 'm_1', seat: 'A', playerId: 'p_alice', ghostOfId: null, queueWaitMs: null },
      { matchId: 'm_1', seat: 'B', playerId: null, ghostOfId: null, queueWaitMs: null },
    ]);
    expect(prisma.callsTo('matchRound.createMany')[0]?.args.data).toHaveLength(2);
  });

  /**
   * La cause premiere de ce message est une suppression de compte ou une purge
   * RGPD. Recopier l'identifiant efface dans un journal applicatif, conserve
   * selon un calendrier qui n'est pas celui de l'effacement, defait une partie
   * de ce que la suppression venait de faire.
   *
   * La redaction de `logger.ts` n'y peut rien : c'est une interpolation de
   * chaine, pas un champ structure, et une regle de redaction ne voit que des
   * cles. Il faut donc ne pas l'ecrire.
   *
   * L'identifiant n'apportait rien d'actionnable non plus : le joueur n'existe
   * plus par definition. `matchId` et le siege suffisent a retrouver la ligne.
   */
  /**
   * Sans verrou, une suppression de joueur glissee entre la lecture et
   * l'insertion fait echouer la transaction entiere sur `P2003` — c'est-a-dire
   * **le seul resultat** que `ON DELETE SET NULL` et cette verification
   * existent tous les deux pour empecher. `FOR KEY SHARE` est exactement le
   * mode de verrou que Postgres prend lui-meme en validant une cle etrangere :
   * il bloque un `DELETE` concurrent jusqu'au commit, et reste compatible avec
   * lui-meme, donc deux matchs partageant un joueur ne se serialisent pas.
   */
  it('verrouille les joueurs qu il vient de lire, jusqu au commit', async () => {
    await repository.save(aRecord());

    const query = prisma.callsTo('$queryRaw')[0]?.args.where as { sql: string; asked: string[] };
    expect(query.sql).toContain('FOR KEY SHARE');
    expect(query.asked).toEqual(['p_alice', 'p_bob']);
  });

  it('ne recopie pas dans le journal l identifiant du joueur disparu', async () => {
    prisma.players.delete('p_bob');

    await repository.save(aRecord());

    const sortie = lines.join('');
    expect(sortie).not.toContain('p_bob');
    expect(sortie).not.toContain('p_alice');
    // Ce qui reste doit suffire a comprendre : le match et le siege en cause.
    expect(sortie).toContain('m_1');
    expect(sortie).toContain('B');
  });

  it('ne demande a la base que les joueurs qu un siege revendique', async () => {
    await repository.save(aRecord({ seats: { a: 'p_alice', b: null } }));

    const query = prisma.callsTo('$queryRaw')[0]?.args.where as { asked: string[] };
    expect(query.asked).toEqual(['p_alice']);
  });

  it('n interroge pas la base quand aucun siege n est attribue', async () => {
    await repository.save(aRecord({ seats: { a: null, b: null } }));

    expect(prisma.callsTo('$queryRaw')).toHaveLength(0);
    expect(prisma.callsTo('matchSeat.createMany')[0]?.args.data).toEqual([
      { matchId: 'm_1', seat: 'A', playerId: null, ghostOfId: null, queueWaitMs: null },
      { matchId: 'm_1', seat: 'B', playerId: null, ghostOfId: null, queueWaitMs: null },
    ]);
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
   * La panne vraisemblable est locale au journal : `atMs` est la seule valeur
   * de l'enveloppe qui sorte d'un calcul sur des horloges. Les compteurs, eux,
   * sortent d'un `+= 1` sur des champs a zero — les jeter avec le journal
   * eteindrait le signal « Latence » pour un horodatage aberrant.
   */
  it('abandonne le journal mais garde les compteurs quand une entree est hors schema', async () => {
    await repository.save(
      aRecord({
        events: [{ atMs: Number.NaN, event: { type: 'recharge:tap' } }],
        impossibleTaps: { a: 5, b: 0 },
      }),
    );

    const events = eventsColumnOf(prisma);
    expect(events.entries).toEqual([]);
    expect(events.omittedEntries).toBe(1);
    expect(events.counters).toMatchObject({ A: { impossibleTaps: 5 }, B: { impossibleTaps: 0 } });
    expect(lines.join('')).toContain('entries.0.atMs');
  });

  /**
   * Cas inatteignable aujourd'hui — les compteurs viennent d'un type `number`.
   * Il fixe le sens de la derniere chute : quand ce sont les compteurs qui sont
   * en cause, plus rien de la colonne n'est croyable, mais la graine, les
   * sieges et les manches partent quand meme.
   */
  it('ecrit une colonne nulle quand les compteurs eux-memes sont hors schema', async () => {
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

  /**
   * Un journal entierement malforme produit autant de chemins que d'entrees.
   * Une ligne de journal de plusieurs kilo-octets, emise quand le serveur va
   * deja mal, n'aide personne.
   */
  it('borne la liste des chemins fautifs', async () => {
    const journal = Array.from({ length: 500 }, (_, index) => ({
      atMs: Number.NaN,
      event: { index },
    }));

    await repository.save(aRecord({ events: journal }));

    const ligne = lines.find((ecrite) => ecrite.includes('hors schema')) ?? '';
    const message = (JSON.parse(ligne) as { msg: string }).msg;
    expect(message.match(/entries\.\d+\.atMs/g)).toHaveLength(10);
    expect(message).toContain('+490 autres');
    expect(message.length).toBeLessThan(500);
  });

  /**
   * Quand la colonne part nulle, la cause est forcement du cote des compteurs.
   * Afficher les fautes de la premiere passe la noierait sous des chemins
   * `entries.*` : `z.object` valide dans l'ordre de declaration, et les
   * entrees passent en premier.
   */
  it('nomme la vraie cause quand la colonne part nulle', async () => {
    const journal = Array.from({ length: 500 }, (_, index) => ({
      atMs: Number.NaN,
      event: { index },
    }));

    await repository.save(aRecord({ events: journal, rejectedEvents: { a: -1, b: 0 } }));

    const data = prisma.callsTo('match.create')[0]?.args.data as { events: unknown };
    expect(data.events).toBe(Prisma.JsonNull);
    const ligne = lines.find((ecrite) => ecrite.includes('hors schema')) ?? '';
    const message = (JSON.parse(ligne) as { msg: string }).msg;
    expect(message).toContain('counters.A.rejectedEvents');
    expect(message).not.toContain('entries.');
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

  /**
   * L'ecriture d'un match ne retarde aucun joueur : elle n'apparait donc dans
   * le temps de traitement d'aucun message. C'est precisement pourquoi elle a
   * son propre chronometre — a mille matchs simultanes, elle cesse d'aboutir
   * sans que la moindre latence ne bouge, et le seul signe est ce compteur.
   */
  it('chronometre chaque ecriture, reussie ou non', async () => {
    await repository.save(aRecord({ matchId: 'm_ok' }));
    prisma.failOn = 'matchRound.createMany';
    await expect(repository.save(aRecord({ matchId: 'm_ko' }))).rejects.toThrow();

    const snapshot = metrics.snapshot();
    if (!snapshot.enabled) throw new Error('mesure eteinte');
    expect(snapshot.tasks['match:save']?.count).toBe(2);
    expect(snapshot.tasks['match:save']?.failures).toBe(1);
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

  /**
   * Les messages de Prisma commencent par un saut de ligne : ne garder que la
   * premiere ligne les reduisait a une chaine vide, et le journal ne disait
   * plus **rien** de la panne. Le code d'erreur (`P2002`…) nomme la cause sans
   * recopier le moindre argument — c'est la seule partie sure du diagnostic.
   */
  it('nomme le code d une erreur Prisma dont le message commence par un saut de ligne', async () => {
    const connue = Object.assign(
      new Error("\nInvalid `prisma.matchRound.createMany()` invocation\n  seed: 'graine'"),
      { name: 'PrismaClientKnownRequestError', code: 'P2002' },
    );
    prisma.failOn = 'matchRound.createMany';
    prisma.failWith = connue;

    await expect(repository.save(aRecord())).rejects.toThrow();

    const sortie = lines.join('');
    expect(sortie).toContain('P2002');
    expect(sortie).not.toContain('graine');
  });

  it('borne la cause journalisee d une erreur bavarde', async () => {
    const bavarde = new Error('x'.repeat(5_000));
    prisma.failOn = 'match.create';
    prisma.failWith = bavarde;

    await expect(repository.save(aRecord())).rejects.toThrow();

    expect(lines.join('')).not.toContain('x'.repeat(500));
  });
});

/*
  Les delais du bassin (`shared/database-timeouts.ts`) sont communs a tous les
  modules : la transaction qui enregistre un match doit y tenir.
*/
describe('TRANSACTION_OPTIONS', () => {
  it('tient dans les delais de la base', () => {
    // Une transaction encore dans ses delais n'est jamais fermee par Postgres.
    expect(DATABASE_TIMEOUTS.idleInTransactionMs).toBeGreaterThan(TRANSACTION_OPTIONS.timeout);
    // Postgres ne coupe pas une instruction (l'attente du verrou FOR KEY SHARE
    // comprise) avant que sa transaction n'ait elle-meme expire.
    expect(DATABASE_TIMEOUTS.statementMs).toBeGreaterThanOrEqual(TRANSACTION_OPTIONS.timeout);
  });
});
