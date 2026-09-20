import { randomUUID } from 'node:crypto';
import { RULES_VERSION } from '@aura/rules';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';
import { afterAll, describe, expect, it } from 'vitest';
import type { PrismaService } from '../../../shared/prisma.service.js';
import { isSeedGhost, selectGhost, type GhostRound } from '../domain/ghost.js';
import { seedGhostCoverage, SEED_GHOST_MMR_STEP } from '../domain/ghost-seeding.js';
import { DEFAULT_MMR, DEFAULT_REGION } from '../domain/ticket.js';
import { PrismaGhostStore } from './prisma-ghost.store.js';

/**
 * Test d'integration de la reserve de fantomes (docs/05, docs/04).
 *
 * Les tests unitaires verifient ce qu'on **demande** a Prisma ; seul celui-ci
 * verifie ce que Postgres **accepte** — la colonne `Json`, la fourchette de
 * MMR par l'index, et surtout l'atomicite du remplacement : entre la
 * suppression de l'ancien enregistrement et l'ecriture du nouveau, un tour
 * d'appariement ne doit jamais trouver ce joueur sans fantome.
 *
 * Il se saute proprement si la base n'est pas joignable, pour qu'une machine
 * sans `docker compose up` ne voie pas une suite rouge sans raison.
 */

try {
  process.loadEnvFile(new URL('../../../../../../.env', import.meta.url));
} catch {
  // En CI les variables viennent de l'environnement.
}

const databaseUrl = process.env.DATABASE_URL ?? '';

/**
 * Ce test **ecrit et supprime** des lignes : jamais ailleurs qu'en local.
 * Un `.env` de preprod oublie suffirait sinon a effacer des lignes reelles.
 */
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1', 'host.docker.internal']);

function isLocalDatabase(url: string): boolean {
  try {
    return LOCAL_HOSTS.has(new URL(url).hostname);
  } catch {
    return false;
  }
}

async function connect(): Promise<PrismaClient | null> {
  if (databaseUrl === '' || !isLocalDatabase(databaseUrl)) return null;
  try {
    const client = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl }) });
    await client.$queryRaw`select 1`;
    return client;
  } catch {
    return null;
  }
}

const prisma = await connect();
const reachable = prisma !== null;

afterAll(async () => {
  await prisma?.$disconnect();
});

const aRound = (over: Partial<GhostRound> = {}): GhostRound => ({
  move: { style: 'provoc', tier: 3 },
  amplifier: 2,
  useUltimate: false,
  timing: { quality: 'perfect', delta: 0.02 },
  rechargePoints: 17,
  rechargeTaps: 15,
  ...over,
});

describe.skipIf(!reachable)('PrismaGhostStore — reserve reelle', () => {
  const store = (): PrismaGhostStore => new PrismaGhostStore(prisma as unknown as PrismaService);

  /** Un joueur neuf par scenario : la base de developpement est partagee. */
  const newPlayerId = (): string => `ghosttest_${randomUUID()}`;

  const cleanUp = async (playerId: string): Promise<void> => {
    await prisma!.ghostRecording.deleteMany({ where: { playerId } });
  };

  it('ecrit un enregistrement et le relit tel quel', async () => {
    const playerId = newPlayerId();
    const rounds = [aRound(), aRound({ move: { style: 'calme', tier: 0 }, amplifier: 0 })];

    await store().save({
      playerId,
      mmr: 1_337,
      rulesVersion: 'itest-1.0.0',
      rounds,
      atMs: Date.now(),
    });

    const found = await store().candidates({
      rulesVersion: 'itest-1.0.0',
      mmr: 1_337,
      range: 50,
      limit: 10,
    });

    const mine = found.find((recording) => recording.playerId === playerId);
    expect(mine?.mmr).toBe(1_337);
    expect(mine?.rounds).toEqual(rounds);

    await cleanUp(playerId);
  });

  /** Une ligne par joueur : sans cela la table grossit d'une ligne par match classe. */
  it('remplace l enregistrement precedent du meme joueur', async () => {
    const playerId = newPlayerId();
    const subject = store();

    await subject.save({
      playerId,
      mmr: 1_000,
      rulesVersion: 'itest-1.0.0',
      rounds: [aRound()],
      atMs: Date.now() - 1_000,
    });
    await subject.save({
      playerId,
      mmr: 1_100,
      rulesVersion: 'itest-1.0.0',
      rounds: [aRound(), aRound()],
      atMs: Date.now(),
    });

    const rows = await prisma!.ghostRecording.findMany({ where: { playerId } });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.mmr).toBe(1_100);

    await cleanUp(playerId);
  });

  it('ne rend pas un enregistrement hors de la fourchette de MMR', async () => {
    const playerId = newPlayerId();
    await store().save({
      playerId,
      mmr: 2_000,
      rulesVersion: 'itest-1.0.0',
      rounds: [aRound()],
      atMs: Date.now(),
    });

    const found = await store().candidates({
      rulesVersion: 'itest-1.0.0',
      mmr: 1_000,
      range: 400,
      limit: 10,
    });

    expect(found.map((recording) => recording.playerId)).not.toContain(playerId);

    await cleanUp(playerId);
  });

  it('ne rend pas un enregistrement d une autre version des regles', async () => {
    const playerId = newPlayerId();
    await store().save({
      playerId,
      mmr: 1_000,
      rulesVersion: 'itest-0.0.1',
      rounds: [aRound()],
      atMs: Date.now(),
    });

    const found = await store().candidates({
      rulesVersion: 'itest-1.0.0',
      mmr: 1_000,
      range: 400,
      limit: 10,
    });

    expect(found.map((recording) => recording.playerId)).not.toContain(playerId);

    await cleanUp(playerId);
  });

  /**
   * Des octets illisibles ne doivent pas faire tomber un tour d'appariement :
   * l'enregistrement est simplement ignore, comme s'il n'existait pas.
   */
  it('ecarte un enregistrement dont les manches ne passent pas le schema', async () => {
    const playerId = newPlayerId();
    await prisma!.ghostRecording.create({
      data: {
        playerId,
        mmr: 1_000,
        rulesVersion: 'itest-1.0.0',
        rounds: [{ move: { style: 'inconnu', tier: 9 } }],
      },
    });

    const found = await store().candidates({
      rulesVersion: 'itest-1.0.0',
      mmr: 1_000,
      range: 400,
      limit: 10,
    });

    expect(found.map((recording) => recording.playerId)).not.toContain(playerId);

    await cleanUp(playerId);
  });
});

/**
 * Le vivier d'amorcage, tel que `pnpm --filter server seed` l'a pose.
 *
 * Lecture seule : cette suite ne touche a rien: elle verifie que la base de
 * developpement est dans l'etat ou sera une base de production le jour du
 * lancement, et qu'un joueur neuf y trouve un adversaire. Elle se saute si le
 * seed n'a pas ete joue — ce n'est pas un echec, c'est une base vierge.
 */
describe.skipIf(!reachable)('vivier d amorcage en base', () => {
  const store = (): PrismaGhostStore => new PrismaGhostStore(prisma as unknown as PrismaService);

  const seededCount = async (): Promise<number> =>
    prisma!.ghostRecording.count({
      where: { playerId: { startsWith: 'seed:' }, rulesVersion: RULES_VERSION },
    });

  it('contient des enregistrements pour la version des regles en cours', async () => {
    const count = await seededCount();
    if (count === 0) {
      console.warn('[integration] seed non joue : `pnpm --filter server seed` pour ce scenario');
      return;
    }
    expect(count).toBeGreaterThan(0);
  });

  /**
   * Le chemin reel, bout a bout : la requete que le serveur envoie, puis la
   * selection qu'il applique. C'est ce qui a manque au premier essai de bout en
   * bout — la logique d'attente tournait, la reserve etait vide.
   */
  it('rend un adversaire a un joueur neuf qui attend seul', async () => {
    if ((await seededCount()) === 0) return;

    const candidates = await store().candidates({
      rulesVersion: RULES_VERSION,
      mmr: DEFAULT_MMR,
      range: 400,
      limit: 32,
    });

    const chosen = selectGhost(
      candidates,
      {
        playerId: 'p_nouveau',
        mode: 'ranked',
        mmr: DEFAULT_MMR,
        enqueuedAtMs: 0,
        region: DEFAULT_REGION,
        recentOpponents: [],
      },
      25_000,
      RULES_VERSION,
    );

    expect(chosen).not.toBeNull();
    expect(chosen!.rounds.length).toBeGreaterThan(0);
    expect(Math.abs(chosen!.mmr - DEFAULT_MMR)).toBeLessThanOrEqual(SEED_GHOST_MMR_STEP / 2);
  });

  it('couvre les deux extremites de la plage annoncee', async () => {
    if ((await seededCount()) === 0) return;
    const coverage = seedGhostCoverage();

    for (const mmr of [Math.max(0, coverage.min), coverage.max]) {
      const candidates = await store().candidates({
        rulesVersion: RULES_VERSION,
        mmr,
        range: 400,
        limit: 32,
      });
      const chosen = selectGhost(
        candidates,
        {
          playerId: 'p_extreme',
          mode: 'ranked',
          mmr,
          enqueuedAtMs: 0,
          region: DEFAULT_REGION,
          recentOpponents: [],
        },
        25_000,
        RULES_VERSION,
      );
      expect(chosen, `aucun fantome pour un joueur a ${String(mmr)} de MMR`).not.toBeNull();
      expect(isSeedGhost(chosen!.playerId)).toBe(true);
    }
  });
});
