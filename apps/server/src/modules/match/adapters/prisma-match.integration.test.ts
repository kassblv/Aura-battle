import { randomUUID } from 'node:crypto';
import { BALANCE, type Choice } from '@aura/rules';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';
import { afterAll, describe, expect, it } from 'vitest';
import { createLogger, PinoLoggerService } from '../../../shared/logger.js';
import { loadConfig } from '../../../shared/config.js';
import type { MatchClock, MatchNotifier, TimerScheduler } from '../domain/ports.js';
import { MatchRuntime } from '../application/match-runtime.js';
import { PrismaMatchRepository } from './prisma-match.repository.js';

/**
 * Test d'integration : un match joue jusqu'au bout doit vraiment atterrir en
 * base.
 *
 * Les tests unitaires de l'adaptateur verifient ce qu'on **demande** a Prisma ;
 * seul celui-ci verifie ce que Postgres **accepte** — contraintes, enums,
 * colonnes JSON, transaction. Les deux sont necessaires et aucun ne remplace
 * l'autre.
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
 * La joignabilite se decide **au chargement du module**, pas dans `beforeAll`.
 *
 * `describe.skipIf` est evalue a la collecte des tests, donc avant que le
 * moindre `beforeAll` ne s'execute : une variable renseignee plus tard vaudrait
 * toujours `false` au moment de decider.
 */
async function connect(): Promise<PrismaClient | null> {
  if (databaseUrl === '') return null;
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

/** Minuteur manuel : le match avance quand on le pousse. */
class Manual implements TimerScheduler {
  private readonly timers = new Map<string, { atMs: number; run: () => void }>();
  constructor(private readonly clock: Movable) {}
  schedule(key: string, atMs: number, run: () => void): void {
    this.timers.set(key, { atMs, run });
  }
  cancel(key: string): void {
    this.timers.delete(key);
  }
  fire(key: string): boolean {
    const timer = this.timers.get(key);
    if (timer === undefined) return false;
    this.timers.delete(key);
    this.clock.current = Math.max(this.clock.current, timer.atMs);
    timer.run();
    return true;
  }
}

class Movable implements MatchClock {
  current = Date.now();
  now(): number {
    return this.current;
  }
}

const silent: MatchNotifier = { send: () => undefined };

const choice = (tier: 0 | 1 | 2 | 3 | 4): Choice => ({
  move: { style: 'calme', tier },
  amplifier: 0,
  useUltimate: false,
});

describe.skipIf(!reachable)('ecriture reelle en base', () => {
  it('ecrit le match, ses deux sieges et ses manches', async () => {
    const config = loadConfig({
      DATABASE_URL: databaseUrl,
      REDIS_URL: 'redis://localhost:6379',
      JWT_SECRET: 'un-secret-assez-long',
      NODE_ENV: 'test',
    });
    const repository = new PrismaMatchRepository(
      prisma as never,
      new PinoLoggerService(createLogger(config)),
    );

    const clock = new Movable();
    const scheduler = new Manual(clock);
    const runtime = new MatchRuntime(silent, scheduler, clock, BALANCE, repository);

    const matchId = `m_${randomUUID()}`;
    const seed = randomUUID();
    runtime.createMatch({ matchId, seed, seats: { a: null as never, b: null as never } });

    // Deux manches gagnees par le siege a.
    for (let round = 1; round <= 2; round += 1) {
      while (runtime.phaseOf(matchId) !== 'choice' && runtime.phaseOf(matchId) !== null) {
        scheduler.fire(matchId);
      }
      if (runtime.phaseOf(matchId) === null) break;
      runtime.lockChoice(matchId, 'a', choice(3), null);
      runtime.lockChoice(matchId, 'b', choice(0), null);
      scheduler.fire(matchId);
    }

    // L'ecriture ne bloque pas la fin de partie : on lui laisse le temps.
    await new Promise((resolve) => setTimeout(resolve, 500));

    const written = await prisma!.match.findUnique({
      where: { id: matchId },
      include: { seats: true, rounds: true },
    });

    expect(written).not.toBeNull();
    expect(written?.seed).toBe(seed);
    expect(written?.status).toBe('ENDED');
    expect(written?.winnerSeat).toBe('A');
    expect(written?.endReason).toBe('rounds');
    // Les deux sieges, meme sans joueur rattache.
    expect(written?.seats).toHaveLength(2);
    expect(written?.rounds).toHaveLength(2);

    // L'enveloppe du journal est bien une enveloppe, pas un tableau nu.
    const events = written?.events as { entries?: unknown[]; counters?: unknown } | null;
    expect(Array.isArray(events?.entries)).toBe(true);
    expect(events?.counters).toBeDefined();

    await prisma!.match.delete({ where: { id: matchId } });
  });

  it('n ecrit rien pour un match encore en cours', async () => {
    const config = loadConfig({
      DATABASE_URL: databaseUrl,
      REDIS_URL: 'redis://localhost:6379',
      JWT_SECRET: 'un-secret-assez-long',
      NODE_ENV: 'test',
    });
    const repository = new PrismaMatchRepository(
      prisma as never,
      new PinoLoggerService(createLogger(config)),
    );
    const clock = new Movable();
    const scheduler = new Manual(clock);
    const runtime = new MatchRuntime(silent, scheduler, clock, BALANCE, repository);

    const matchId = `m_${randomUUID()}`;
    runtime.createMatch({
      matchId,
      seed: randomUUID(),
      seats: { a: null as never, b: null as never },
    });
    await new Promise((resolve) => setTimeout(resolve, 200));

    expect(await prisma!.match.findUnique({ where: { id: matchId } })).toBeNull();
  });
});

describe.skipIf(reachable)('base indisponible', () => {
  it('signale pourquoi le test d integration a ete saute', () => {
    // Un saut silencieux laisse croire a une couverture qui n'existe pas.
    console.warn(
      '[integration] base injoignable sur DATABASE_URL — lancez `docker compose up -d` pour executer ce test',
    );
    expect(reachable).toBe(false);
  });
});
