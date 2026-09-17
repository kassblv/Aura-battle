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
 * seul celui-ci verifie ce que Postgres **accepte** — cles etrangeres, enums,
 * colonnes JSON, atomicite de la transaction. Les deux sont necessaires et
 * aucun ne remplace l'autre.
 *
 * Deux points valent d'etre exerces ici et nulle part ailleurs : un siege
 * rattache a un **vrai** joueur, donc la cle etrangere ; et une ecriture qui
 * echoue en cours de route, qui ne doit **rien** laisser derriere elle. Un
 * double de test ne peut demontrer ni l'une ni l'autre.
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
/**
 * Ce test **ecrit et supprime** des lignes. Il ne doit donc jamais toucher
 * autre chose qu'une base de developpement locale.
 *
 * Le garde-fou n'est pas theorique : un `.env` de preprod oublie, ou une
 * variable exportee dans un shell, suffisent a pointer `DATABASE_URL` ailleurs.
 * Le test « marcherait » tout aussi bien — et effacerait des lignes reelles.
 * On exige donc explicitement un hote local.
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
  if (databaseUrl === '') return null;
  if (!isLocalDatabase(databaseUrl)) {
    console.warn(
      '[integration] DATABASE_URL ne designe pas un hote local : test ignore. ' +
        'Ce test ecrit et supprime des lignes, il ne doit jamais viser une base distante.',
    );
    return null;
  }
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

/** Cree un joueur reel, pour que la cle etrangere des sieges soit exercee. */
async function createPlayer(): Promise<string> {
  const player = await prisma!.player.create({
    data: { displayName: `Test ${randomUUID().slice(0, 8)}` },
    select: { id: true },
  });
  return player.id;
}

/** Monte un runtime branche sur le vrai depot. */
function buildRuntime(): { runtime: MatchRuntime; scheduler: Manual; clock: Movable } {
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
  return {
    runtime: new MatchRuntime(silent, scheduler, clock, BALANCE, repository),
    scheduler,
    clock,
  };
}

/** Joue deux manches gagnees par le siege a. */
function playToVictory(runtime: MatchRuntime, scheduler: Manual, matchId: string): void {
  for (let round = 1; round <= 2; round += 1) {
    while (runtime.phaseOf(matchId) !== 'choice' && runtime.phaseOf(matchId) !== null) {
      scheduler.fire(matchId);
    }
    if (runtime.phaseOf(matchId) === null) break;
    runtime.lockChoice(matchId, 'a', choice(3), null);
    runtime.lockChoice(matchId, 'b', choice(0), null);
    scheduler.fire(matchId);
  }
}

/** L'ecriture ne bloque pas la fin de partie : on lui laisse le temps. */
const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 600));

const choice = (tier: 0 | 1 | 2 | 3 | 4): Choice => ({
  move: { style: 'calme', tier },
  amplifier: 0,
  useUltimate: false,
});

describe.skipIf(!reachable)('ecriture reelle en base', () => {
  it('ecrit le match, ses deux sieges rattaches a de vrais joueurs, et ses manches', async () => {
    const [playerA, playerB] = [await createPlayer(), await createPlayer()];
    const { runtime, scheduler } = buildRuntime();

    const matchId = `m_${randomUUID()}`;
    const seed = randomUUID();
    runtime.createMatch({ matchId, seed, seats: { a: playerA, b: playerB } });
    playToVictory(runtime, scheduler, matchId);
    await settle();

    const written = await prisma!.match.findUnique({
      where: { id: matchId },
      include: { seats: true, rounds: true },
    });

    expect(written).not.toBeNull();
    expect(written?.seed).toBe(seed);
    expect(written?.status).toBe('ENDED');
    expect(written?.winnerSeat).toBe('A');
    expect(written?.endReason).toBe('rounds');
    expect(written?.rounds).toHaveLength(2);

    // La cle etrangere est reellement exercee : les sieges portent des joueurs
    // qui existent, ce qu'un double de test ne peut pas verifier.
    const seats = [...(written?.seats ?? [])].sort((l, r) => l.seat.localeCompare(r.seat));
    expect(seats.map((s) => s.seat)).toEqual(['A', 'B']);
    expect(seats.map((s) => s.playerId)).toEqual([playerA, playerB]);

    const events = written?.events as { entries?: unknown[]; counters?: unknown } | null;
    expect(Array.isArray(events?.entries)).toBe(true);
    expect(events?.counters).toBeDefined();

    await prisma!.match.delete({ where: { id: matchId } });
    await prisma!.player.deleteMany({ where: { id: { in: [playerA, playerB] } } });
  });

  it('ne laisse rien derriere elle quand l ecriture echoue', async () => {
    // Un siege rattache a un joueur inexistant viole la cle etrangere **apres**
    // que le match a ete cree dans la transaction. Si l'atomicite tient, la
    // ligne de match ne doit pas survivre — c'est la seule chose que ce test
    // apporte et que le double ne peut pas prouver.
    const playerA = await createPlayer();
    const fantome = randomUUID();
    const { runtime, scheduler } = buildRuntime();

    const matchId = `m_${randomUUID()}`;
    runtime.createMatch({ matchId, seed: randomUUID(), seats: { a: playerA, b: fantome } });
    playToVictory(runtime, scheduler, matchId);
    await settle();

    expect(await prisma!.match.findUnique({ where: { id: matchId } })).toBeNull();
    expect(await prisma!.matchSeat.findMany({ where: { matchId } })).toHaveLength(0);
    expect(await prisma!.matchRound.findMany({ where: { matchId } })).toHaveLength(0);

    await prisma!.player.delete({ where: { id: playerA } });
  });

  it('n ecrit rien pour un match encore en cours', async () => {
    const { runtime } = buildRuntime();
    const matchId = `m_${randomUUID()}`;
    // Le match ne se termine pas, donc rien n'est ecrit : les identifiants de
    // joueur n'ont pas besoin d'exister.
    runtime.createMatch({
      matchId,
      seed: randomUUID(),
      seats: { a: randomUUID(), b: randomUUID() },
    });
    await settle();

    expect(await prisma!.match.findUnique({ where: { id: matchId } })).toBeNull();
  });
});

describe('garde-fou de la base visee', () => {
  it('refuse une base distante, qui pourrait etre une vraie', () => {
    expect(isLocalDatabase('postgresql://u:p@db.production.example.com:5432/aura')).toBe(false);
    expect(isLocalDatabase('postgresql://u:p@10.0.0.4:5432/aura')).toBe(false);
    expect(isLocalDatabase('pas-une-url')).toBe(false);
  });

  it('accepte les hotes locaux', () => {
    expect(isLocalDatabase('postgresql://aura:aura@localhost:5433/aura')).toBe(true);
    expect(isLocalDatabase('postgresql://aura:aura@127.0.0.1:5433/aura')).toBe(true);
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
