import { createHash } from 'node:crypto';
import { monitorEventLoopDelay } from 'node:perf_hooks';
import { BenchPlayer, type PlayerStats } from './player.js';
import {
  percentilesOf,
  type BenchOptions,
  type DriverMessage,
  type WorkerMessage,
  type WorkerStats,
} from './protocol.js';

/**
 * Un lot de matchs, tenu par un processus client (jalon M7).
 *
 * Chaque processus ouvre ses propres sessions, connecte ses sockets et joue
 * ses matchs. L'orchestrateur ne lui parle qu'a quatre moments : prepare,
 * ouvre, mesure, rends tes comptes.
 */

/** Sessions ouvertes en parallele. Au-dela, c'est le banc qu'on mesure. */
const AUTH_CONCURRENCY = 16;

const loop = monitorEventLoopDelay({ resolution: 10 });

let players: BenchPlayer[] = [];
let pairs: [BenchPlayer, BenchPlayer][] = [];
let options: BenchOptions | null = null;

/**
 * Secret d'appareil du joueur `index`, stable d'un relevé a l'autre.
 *
 * Deterministe a dessein : sans cela chaque passage creerait mille comptes de
 * plus, et deux relevés ne porteraient jamais sur la meme population — or
 * comparer deux relevés est tout l'interet d'avoir un banc.
 */
function deviceSecretOf(index: number): string {
  return createHash('sha256')
    .update(`aura-bench-player-${String(index)}`)
    .digest('hex');
}

/**
 * Une adresse IP par joueur simule (10.x.y.z), annoncee par `X-Forwarded-For`.
 *
 * `/auth/device` est limite par adresse (ADR 0013) : mille joueurs depuis
 * 127.0.0.1 seraient refuses des le soixante et unieme. Le serveur du banc
 * croit le mandataire local (`TRUST_PROXY=loopback`, voir `load.ts`) : chaque
 * joueur simule a donc son adresse, comme de vrais joueurs — sans couper la
 * limite, qui reste celle de la production.
 */
export function addressOf(index: number): string {
  return `10.${String((index >> 16) & 255)}.${String((index >> 8) & 255)}.${String(index & 255)}`;
}

/** Ouvre une session invitee et rend son jeton d'acces. */
async function openSession(httpUrl: string, index: number): Promise<string> {
  const response = await fetch(`${httpUrl}/auth/device`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': addressOf(index) },
    body: JSON.stringify({ deviceSecret: deviceSecretOf(index) }),
  });
  if (!response.ok) {
    throw new Error(
      `/auth/device a repondu ${String(response.status)} pour le joueur ${String(index)}`,
    );
  }
  const session = (await response.json()) as { accessToken: string };
  return session.accessToken;
}

/** Applique `run` a chaque element, sans depasser `limit` en vol. */
async function mapLimit<T, R>(
  items: readonly T[],
  limit: number,
  run: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (;;) {
      const index = next++;
      if (index >= items.length) return;
      results[index] = await run(items[index]!, index);
    }
  });
  await Promise.all(workers);
  return results;
}

async function prepare(firstIndex: number, matches: number, config: BenchOptions): Promise<void> {
  options = config;
  const playerOptions = {
    wsUrl: config.wsUrl,
    tapBatchMs: config.tapBatchMs,
    tapsPerSecond: config.tapsPerSecond,
    lockAtPct: config.lockAtPct,
    pingMs: config.pingMs,
    connectTimeoutMs: config.connectTimeoutMs,
    connectAttempts: config.connectAttempts,
  };

  const indexes = Array.from({ length: matches * 2 }, (_, offset) => firstIndex + offset);
  let done = 0;
  const tokens = await mapLimit(indexes, AUTH_CONCURRENCY, async (index) => {
    const token = await openSession(config.httpUrl, index);
    done += 1;
    if (done % 25 === 0) {
      reply({ type: 'progress', phase: 'sessions', done, total: indexes.length });
    }
    return token;
  });

  players = indexes.map(
    (index, position) =>
      new BenchPlayer(`bench_${String(index)}`, { ...playerOptions, token: tokens[position]! }),
  );

  let connected = 0;
  await mapLimit(players, config.connectConcurrency, async (player) => {
    await player.connected();
    connected += 1;
    if (connected % 25 === 0) {
      reply({ type: 'progress', phase: 'sockets', done: connected, total: players.length });
    }
  });

  pairs = [];
  for (let i = 0; i < players.length; i += 2) {
    pairs.push([players[i]!, players[i + 1]!]);
  }
}

/**
 * Ouvre les matchs, etales sur la fenetre de montee en charge.
 *
 * L'etalement n'est pas cosmetique : ouverts tous ensemble, les 500 matchs
 * changeraient de phase a la meme milliseconde et le serveur ne verrait que
 * des rafales separees par du vide. Un vrai serveur voit des matchs qui ont
 * commence a des moments differents — c'est ce regime-la qu'il faut mesurer.
 */
async function openMatches(): Promise<number> {
  const config = options;
  if (config === null) throw new Error('banc non prepare');

  const gapMs = pairs.length <= 1 ? 0 : config.rampMs / pairs.length;
  let opened = 0;

  for (const [host, guest] of pairs) {
    // Un match qui se termine en laisse un de moins : on en rouvre un tout de
    // suite pour que la population reste a l'effectif annonce pendant tout le
    // relevé.
    host.onMatchEnded = () => {
      void reopen(host, guest);
    };

    if (config.pairing === 'queue') {
      host.joinQueue('ranked');
      guest.joinQueue('ranked');
    } else {
      const code = await host.createInvite();
      guest.joinInvite(code);
    }
    opened += 1;
    if (gapMs > 0) await sleep(gapMs);
  }

  await Promise.all(players.map((player) => player.seated()));
  return opened;
}

async function reopen(host: BenchPlayer, guest: BenchPlayer): Promise<void> {
  const config = options;
  if (config === null) return;
  try {
    if (config.pairing === 'queue') {
      host.joinQueue('ranked');
      guest.joinQueue('ranked');
      return;
    }
    const code = await host.createInvite();
    guest.joinInvite(code);
  } catch {
    // Un match non rouvert reduit la population ; l'orchestrateur le verra
    // dans le compteur de matchs vivants du serveur, qui est la source de
    // verite. Faire tomber le processus client serait pire.
  }
}

function collect(): WorkerStats {
  const all = players.map((player) => player.stats());
  const sum = (pick: (stats: PlayerStats) => Record<string, number>): Record<string, number> => {
    const totals: Record<string, number> = {};
    for (const stats of all) {
      for (const [key, value] of Object.entries(pick(stats))) {
        totals[key] = (totals[key] ?? 0) + value;
      }
    }
    return totals;
  };

  return {
    players: players.length,
    sent: sum((stats) => stats.sent),
    received: sum((stats) => stats.received),
    errors: sum((stats) => stats.errors),
    matchesStarted: all.reduce((total, stats) => total + stats.matchesStarted, 0),
    matchesEnded: all.reduce((total, stats) => total + stats.matchesEnded, 0),
    roundsPlayed: all.reduce((total, stats) => total + stats.roundsPlayed, 0),
    disconnects: all.reduce((total, stats) => total + stats.disconnects, 0),
    connect: percentilesOf(all.map((stats) => stats.connectMs)),
    connectRetries: all.filter((stats) => stats.connectAttempts > 1).length,
    rtt: percentilesOf(all.flatMap((stats) => stats.rtt)),
    tapLateness: percentilesOf(all.flatMap((stats) => stats.tapLateness)),
    loopLagP99Ms: Math.round(Math.max(0, loop.percentile(99) / 1_000_000 - 10) * 1_000) / 1_000,
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function reply(message: WorkerMessage): void {
  process.send?.(message);
}

process.on('message', (message: DriverMessage) => {
  void (async () => {
    try {
      switch (message.type) {
        case 'prepare':
          await prepare(message.firstIndex, message.matches, message.options);
          reply({ type: 'prepared', players: players.length });
          break;
        case 'open':
          reply({ type: 'opened', matches: await openMatches() });
          break;
        case 'measure':
          loop.enable();
          for (const player of players) {
            player.beginMeasurement();
            player.start();
          }
          break;
        case 'collect':
          reply({ type: 'stats', stats: collect() });
          break;
        case 'stop':
          for (const player of players) player.stop();
          process.exit(0);
      }
    } catch (cause) {
      reply({ type: 'failed', reason: cause instanceof Error ? cause.message : String(cause) });
    }
  })();
});
