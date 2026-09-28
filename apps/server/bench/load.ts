import { fork, spawn, type ChildProcess } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { cpus, loadavg, totalmem } from 'node:os';
import { fileURLToPath } from 'node:url';
import { createClient } from 'redis';
import type { MetricsSnapshot } from '../src/shared/metrics.js';
import type {
  BenchOptions,
  DriverMessage,
  Percentiles,
  WorkerMessage,
  WorkerStats,
} from './protocol.js';
import { WitnessClient } from './witness.js';
import { randomBytes } from 'node:crypto';

/**
 * Banc de charge du serveur de match (jalon M7).
 *
 * Il repond a une question chiffree : **500 matchs simultanes sur un noeud,
 * p95 de traitement d'un message sous 20 ms**. Et il doit pouvoir la reposer a
 * chaque jalon, dans les memes conditions, pour qu'un relevé se compare au
 * precedent au lieu de se lire seul.
 *
 * Il vit hors de la suite de tests, et c'est delibere : personne ne veut mille
 * connexions a chaque `pnpm test`. On le lance a la main :
 *
 * ```bash
 * docker compose up -d
 * pnpm --filter server bench                 # 500 matchs, 60 s de mesure
 * pnpm --filter server bench -- --matches 1000 --measure-ms 90000
 * ```
 *
 * Trois precautions valent d'etre dites, parce que chacune a deja fausse un
 * relevé dans ce depot.
 *
 * 1. **Le serveur mesure tourne dans son propre processus**, lance par ce
 *    script, sur un port qui n'est pas celui du developpement. Les clients
 *    vivent dans d'autres processus encore : mille sockets dans la boucle du
 *    serveur lui disputeraient son temps, et le relevé parlerait du banc.
 * 2. **Redis est isole dans sa propre base** (`--redis-db`, 9 par defaut).
 *    Plusieurs serveurs de developpement peuvent partager le meme Redis et
 *    leurs workers d'appariement s'effacent alors mutuellement leurs tickets :
 *    le banc mesurerait du bruit.
 * 3. **Un relevé sans temoin ne vaut rien.** Le rapport publie le retard de la
 *    boucle du serveur, sa part de processeur, le retard des clients et le
 *    nombre de matchs reellement vivants. Sur une machine deja chargee, ce
 *    sont eux qui disent si l'on a mesure le serveur ou le poste.
 */

interface BenchArgs {
  readonly matches: number;
  readonly workers: number;
  readonly port: number;
  readonly redisDb: number;
  readonly rampMs: number;
  readonly settleMs: number;
  readonly measureMs: number;
  readonly pairing: 'invite' | 'queue';
  readonly tapBatchMs: number;
  readonly tapsPerSecond: number;
  readonly lockAtPct: number;
  readonly pingMs: number;
  readonly connectConcurrency: number;
  readonly connectTimeoutMs: number;
  readonly connectAttempts: number;
  /** Taille du bassin de connexions Postgres du serveur mesure. */
  readonly dbPool: number;
  readonly label: string;
  /** Serveur deja lance ailleurs : le banc ne le demarre ni ne l'arrete. */
  readonly attach: boolean;
  readonly out: string | null;
}

const DEFAULTS: BenchArgs = {
  matches: 500,
  workers: 4,
  port: 3999,
  redisDb: 9,
  rampMs: 20_000,
  settleMs: 10_000,
  measureMs: 60_000,
  pairing: 'invite',
  tapBatchMs: 500,
  tapsPerSecond: 6,
  lockAtPct: 0.5,
  pingMs: 5_000,
  connectConcurrency: 16,
  connectTimeoutMs: 60_000,
  connectAttempts: 3,
  dbPool: 20,
  label: 'sans-nom',
  attach: false,
  out: null,
};

function parseArgs(argv: readonly string[]): BenchArgs {
  const args: Record<string, string> = {};
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i]!;
    if (!token.startsWith('--')) continue;
    const name = token.slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith('--')) {
      args[name] = 'true';
    } else {
      args[name] = next;
      i += 1;
    }
  }

  const number = (name: string, fallback: number): number => {
    const raw = args[name];
    if (raw === undefined) return fallback;
    const value = Number(raw);
    if (!Number.isFinite(value)) throw new Error(`--${name} attend un nombre, recu « ${raw} »`);
    return value;
  };

  const pairing = args.pairing ?? DEFAULTS.pairing;
  if (pairing !== 'invite' && pairing !== 'queue') {
    throw new Error('--pairing attend « invite » ou « queue »');
  }

  return {
    matches: number('matches', DEFAULTS.matches),
    workers: number('workers', DEFAULTS.workers),
    port: number('port', DEFAULTS.port),
    redisDb: number('redis-db', DEFAULTS.redisDb),
    rampMs: number('ramp-ms', DEFAULTS.rampMs),
    settleMs: number('settle-ms', DEFAULTS.settleMs),
    measureMs: number('measure-ms', DEFAULTS.measureMs),
    pairing,
    tapBatchMs: number('tap-batch-ms', DEFAULTS.tapBatchMs),
    tapsPerSecond: number('taps-per-second', DEFAULTS.tapsPerSecond),
    lockAtPct: number('lock-at-pct', DEFAULTS.lockAtPct),
    pingMs: number('ping-ms', DEFAULTS.pingMs),
    connectConcurrency: number('connect-concurrency', DEFAULTS.connectConcurrency),
    connectTimeoutMs: number('connect-timeout-ms', DEFAULTS.connectTimeoutMs),
    connectAttempts: number('connect-attempts', DEFAULTS.connectAttempts),
    dbPool: number('db-pool', DEFAULTS.dbPool),
    label: args.label ?? DEFAULTS.label,
    attach: args.attach === 'true',
    out: args.out ?? DEFAULTS.out,
  };
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/** Charge le `.env` du depot, comme le fait `main.ts`. */
function loadDotEnv(): void {
  try {
    process.loadEnvFile(fileURLToPath(new URL('../../../.env', import.meta.url)));
  } catch {
    // Ni fichier, ni probleme : les variables peuvent venir de l'environnement.
  }
}

/**
 * Redirige l'URL Redis vers la base du banc.
 *
 * C'est la precaution n°2, et elle se paie cher quand on l'oublie : deux
 * serveurs sur la meme base Redis se reclament les memes tickets de file.
 */
function redisUrlFor(base: string, db: number): string {
  const url = new URL(base);
  url.pathname = `/${String(db)}`;
  return url.toString();
}

/** Vide la base Redis du banc, et prouve du meme coup qu'elle repond. */
async function resetRedis(url: string): Promise<void> {
  const client = createClient({ url });
  await client.connect();
  await client.flushDb();
  await client.close();
}

/** Attend que le serveur reponde, ou renonce. */
async function waitForHealth(httpUrl: string, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      const response = await fetch(`${httpUrl}/health`);
      if (response.ok) return;
    } catch {
      // Pas encore la.
    }
    if (Date.now() > deadline) throw new Error(`le serveur n'a pas repondu sur ${httpUrl}`);
    await sleep(250);
  }
}

/** Vrai si quelque chose ecoute deja ce port. */
async function portIsBusy(httpUrl: string): Promise<boolean> {
  try {
    await fetch(`${httpUrl}/health`, { signal: AbortSignal.timeout(1_000) });
    return true;
  } catch {
    return false;
  }
}

/**
 * Secret des routes de mesure, tire a chaque passage.
 *
 * Le banc lance son propre serveur : personne d'autre n'a besoin de connaitre
 * ce secret, et rien ne justifie d'en poser un dans un fichier. Avec
 * `--attach`, en revanche, le serveur est deja la : son secret vient alors de
 * l'environnement, comme le sien.
 */
const METRICS_TOKEN = process.env.AURA_METRICS_TOKEN ?? randomBytes(24).toString('hex');

/** En-tete a joindre aux deux routes de mesure. */
const METRICS_AUTH = { authorization: `Bearer ${METRICS_TOKEN}` };

function startServer(args: BenchArgs, redisUrl: string): ChildProcess {
  const cwd = fileURLToPath(new URL('..', import.meta.url));
  return spawn(process.execPath, ['--import', 'tsx', 'src/main.ts'], {
    cwd,
    env: {
      ...process.env,
      PORT: String(args.port),
      REDIS_URL: redisUrl,
      DATABASE_POOL_MAX: String(args.dbPool),
      AURA_METRICS: '1',
      AURA_METRICS_TOKEN: METRICS_TOKEN,
      // Les joueurs simules annoncent chacun leur adresse (`worker.ts`) : la
      // limite de debit par IP reste active, comme en production (ADR 0013).
      TRUST_PROXY: 'loopback',
      /**
       * `production`, et pas `development`.
       *
       * En developpement le journal passe par `pino-pretty` et descend au
       * niveau `debug` : une ligne formatee par connexion et par charge
       * invalide. Mesurer ce serveur-la reviendrait a mesurer un formateur
       * de journal.
       */
      NODE_ENV: 'production',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

async function collectStats(children: readonly ChildProcess[]): Promise<WorkerStats[]> {
  const stats = await Promise.all(
    children.map(
      (child) =>
        new Promise<WorkerStats>((resolve, reject) => {
          const onMessage = (message: WorkerMessage): void => {
            if (message.type === 'stats') {
              child.off('message', onMessage);
              resolve(message.stats);
            } else if (message.type === 'failed') {
              child.off('message', onMessage);
              reject(new Error(message.reason));
            }
          };
          child.on('message', onMessage);
          send(child, { type: 'collect' });
        }),
    ),
  );
  return stats;
}

function send(child: ChildProcess, message: DriverMessage): void {
  child.send(message);
}

/** Attend d'un processus client une reponse d'un type donne. */
function expectFrom<T extends WorkerMessage['type']>(
  child: ChildProcess,
  type: T,
  timeoutMs: number,
): Promise<Extract<WorkerMessage, { type: T }>> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      child.off('message', onMessage);
      reject(new Error(`aucun « ${type} » du processus client apres ${String(timeoutMs)} ms`));
    }, timeoutMs);
    const onMessage = (message: WorkerMessage): void => {
      if (message.type === type) {
        clearTimeout(timer);
        child.off('message', onMessage);
        resolve(message as Extract<WorkerMessage, { type: T }>);
      } else if (message.type === 'failed') {
        clearTimeout(timer);
        child.off('message', onMessage);
        reject(new Error(message.reason));
      }
    };
    child.on('message', onMessage);
  });
}

function sumCounters(
  all: readonly WorkerStats[],
  pick: (stats: WorkerStats) => Readonly<Record<string, number>>,
): Record<string, number> {
  const totals: Record<string, number> = {};
  for (const stats of all) {
    for (const [key, value] of Object.entries(pick(stats))) {
      totals[key] = (totals[key] ?? 0) + value;
    }
  }
  return totals;
}

async function main(): Promise<void> {
  loadDotEnv();
  const args = parseArgs(process.argv.slice(2));
  const httpUrl = `http://127.0.0.1:${String(args.port)}`;
  const wsUrl = httpUrl;

  const baseRedis = process.env.REDIS_URL ?? 'redis://localhost:6379';
  const redisUrl = redisUrlFor(baseRedis, args.redisDb);

  console.log(`# banc de charge — ${args.label}`);
  console.log(
    `machine : ${String(cpus().length)} coeurs, ${String(Math.round(totalmem() / 1_073_741_824))} Gio, charge ${loadavg()
      .map((value) => value.toFixed(2))
      .join(' ')}`,
  );

  let server: ChildProcess | null = null;
  const children: ChildProcess[] = [];

  try {
    if (args.attach) {
      await waitForHealth(httpUrl, 5_000);
    } else {
      if (await portIsBusy(httpUrl)) {
        throw new Error(
          `le port ${String(args.port)} est deja pris : un autre serveur y repond. ` +
            'Arrete-le, ou lance le banc avec --port sur un autre port.',
        );
      }
      await resetRedis(redisUrl);
      server = startServer(args, redisUrl);
      server.stderr?.on('data', (chunk: Buffer) => {
        process.stderr.write(`[serveur] ${chunk.toString()}`);
      });
      server.stdout?.on('data', (chunk: Buffer) => {
        const text = chunk.toString();
        // Le serveur est silencieux en production, sauf demarrage et erreurs :
        // tout ce qui sort ici merite d'etre vu.
        if (text.includes('"level":50') || text.includes('serveur pret')) {
          process.stdout.write(`[serveur] ${text}`);
        }
      });
      await waitForHealth(httpUrl, 60_000);
    }

    const probeResponse = await fetch(`${httpUrl}/health/metrics`, { headers: METRICS_AUTH });
    if (probeResponse.status === 401) {
      throw new Error(
        'le serveur refuse le secret de mesure : passe le sien dans AURA_METRICS_TOKEN (obligatoire avec --attach).',
      );
    }
    const probe = (await probeResponse.json()) as { enabled: boolean };
    if (!probe.enabled) {
      throw new Error(
        'le serveur ne mesure rien : il lui manque AURA_METRICS=1. Un relevé pris ici serait vide.',
      );
    }

    const perWorker = Math.ceil(args.matches / args.workers);
    const options: BenchOptions = {
      httpUrl,
      wsUrl,
      pairing: args.pairing,
      tapBatchMs: args.tapBatchMs,
      tapsPerSecond: args.tapsPerSecond,
      lockAtPct: args.lockAtPct,
      pingMs: args.pingMs,
      rampMs: args.rampMs,
      connectConcurrency: args.connectConcurrency,
      connectTimeoutMs: args.connectTimeoutMs,
      connectAttempts: args.connectAttempts,
    };

    const workerPath = fileURLToPath(new URL('./worker.ts', import.meta.url));
    let assigned = 0;
    for (let index = 0; index < args.workers; index += 1) {
      const matches = Math.min(perWorker, args.matches - assigned);
      if (matches <= 0) break;
      const child = fork(workerPath, [], {
        execArgv: ['--import', 'tsx'],
        stdio: ['inherit', 'inherit', 'inherit', 'ipc'],
      });
      const rank = index;
      child.on('message', (message: WorkerMessage) => {
        if (message.type === 'progress') {
          console.log(
            `  client ${String(rank)} : ${message.phase} ${String(message.done)}/${String(message.total)}`,
          );
        }
      });
      children.push(child);
      send(child, { type: 'prepare', firstIndex: assigned * 2, matches, options });
      assigned += matches;
    }

    console.log(`ouverture de ${String(assigned * 2)} sessions…`);
    await Promise.all(children.map((child) => expectFrom(child, 'prepared', 600_000)));

    console.log(`ouverture de ${String(assigned)} matchs sur ${String(args.rampMs)} ms…`);
    for (const child of children) send(child, { type: 'open' });
    await Promise.all(children.map((child) => expectFrom(child, 'opened', args.rampMs + 120_000)));

    console.log(`stabilisation ${String(args.settleMs)} ms…`);
    await sleep(args.settleMs);

    // Le temoin se connecte avant la fenetre : sa propre connexion ne doit pas
    // se retrouver dans le relevé qu'il sert a valider.
    const witness = new WitnessClient();
    await witness.connect(httpUrl, wsUrl);

    // Fenetre de mesure : les deux bouts repartent de zero au meme instant.
    await fetch(`${httpUrl}/health/metrics/reset`, { method: 'POST', headers: METRICS_AUTH });
    witness.start();
    for (const child of children) send(child, { type: 'measure' });
    const loadBefore = loadavg()[0]!;

    console.log(`mesure ${String(args.measureMs)} ms…`);
    await sleep(args.measureMs);

    const snapshot = (await (
      await fetch(`${httpUrl}/health/metrics`, { headers: METRICS_AUTH })
    ).json()) as MetricsSnapshot;
    const workerStats = await collectStats(children);
    const witnessRtt = witness.stop();
    const loadAfter = loadavg()[0]!;

    report(args, snapshot, workerStats, { loadBefore, loadAfter, witnessRtt });
    if (args.out !== null) {
      mkdirSync(fileURLToPath(new URL('./results/', import.meta.url)), { recursive: true });
      const path = fileURLToPath(new URL(`./results/${args.out}`, import.meta.url));
      writeFileSync(
        path,
        JSON.stringify(
          {
            args,
            snapshot,
            workerStats,
            witnessRtt,
            load: { before: loadBefore, after: loadAfter },
          },
          null,
          2,
        ),
      );
      console.log(`\nrelevé ecrit dans ${path}`);
    }
  } finally {
    for (const child of children) {
      child.send({ type: 'stop' } satisfies DriverMessage);
      setTimeout(() => child.kill('SIGKILL'), 2_000).unref();
    }
    await sleep(1_500);
    for (const child of children) child.kill('SIGKILL');
    server?.kill('SIGTERM');
  }
}

function report(
  args: BenchArgs,
  snapshot: MetricsSnapshot,
  workers: readonly WorkerStats[],
  load: { loadBefore: number; loadAfter: number; witnessRtt: Percentiles },
): void {
  const windowSeconds = snapshot.windowMs / 1_000;
  const total = snapshot.messages.total;
  const sent = sumCounters(workers, (stats) => stats.sent);
  const errors = sumCounters(workers, (stats) => stats.errors);
  const sentTotal = Object.values(sent).reduce((sum, value) => sum + value, 0);

  console.log('\n## Relevé');
  console.log(
    `fenetre : ${windowSeconds.toFixed(1)} s — matchs vivants : ${String(snapshot.gauges.liveMatches ?? 0)} / ${String(args.matches)} demandes`,
  );
  console.log(
    `sessions : ${String(snapshot.gauges.liveSessions ?? 0)} — minuteurs armes : ${String(snapshot.gauges.armedTimers ?? 0)}`,
  );

  console.log('\n### Temps de traitement d un message entrant (serveur)');
  console.log(
    `${String(total.count)} messages — ${(total.count / windowSeconds).toFixed(0)}/s — ` +
      `moyenne ${total.meanMs.toFixed(3)} ms, mediane ${total.p50Ms.toFixed(3)} ms`,
  );
  console.log(
    `p90 ${total.p90Ms.toFixed(3)} ms | p95 ${total.p95Ms.toFixed(3)} ms | p99 ${total.p99Ms.toFixed(3)} ms | ` +
      `p999 ${total.p999Ms.toFixed(3)} ms | max ${total.maxMs.toFixed(3)} ms`,
  );
  console.log(`verdict M7 (p95 < 20 ms) : ${total.p95Ms < 20 ? 'TENU' : 'MANQUE'}`);

  console.log('\n### Par message');
  const rows = Object.entries(snapshot.messages.byEvent).sort((a, b) => b[1].count - a[1].count);
  for (const [event, stats] of rows) {
    console.log(
      `${event.padEnd(16)} n=${String(stats.count).padStart(7)}  ` +
        `moy ${stats.meanMs.toFixed(3)}  med ${stats.p50Ms.toFixed(3)}  ` +
        `p95 ${stats.p95Ms.toFixed(3)}  p99 ${stats.p99Ms.toFixed(3)}  max ${stats.maxMs.toFixed(3)}`,
    );
  }
  console.log(
    `filtre d entree seul : med ${snapshot.inboundFilter.p50Ms.toFixed(3)} ms, ` +
      `p95 ${snapshot.inboundFilter.p95Ms.toFixed(3)} ms, max ${snapshot.inboundFilter.maxMs.toFixed(3)} ms`,
  );

  const tasks = Object.entries(snapshot.tasks);
  if (tasks.length > 0) {
    console.log('\n### Taches de fond (hors fenetre de traitement d un message)');
    for (const [name, task] of tasks) {
      console.log(
        `${name.padEnd(16)} n=${String(task.count).padStart(7)}  ` +
          `moy ${task.meanMs.toFixed(1)}  med ${task.p50Ms.toFixed(1)}  ` +
          `p95 ${task.p95Ms.toFixed(1)}  p99 ${task.p99Ms.toFixed(1)}  max ${task.maxMs.toFixed(1)}  ` +
          `echecs ${String(task.failures)}`,
      );
    }
  }

  console.log('\n### Temoins de fiabilite');
  console.log(
    `boucle serveur : retard moyen ${snapshot.eventLoop.lagMeanMs.toFixed(2)} ms, ` +
      `p95 ${snapshot.eventLoop.lagP95Ms.toFixed(2)} ms, p99 ${snapshot.eventLoop.lagP99Ms.toFixed(2)} ms, ` +
      `max ${snapshot.eventLoop.lagMaxMs.toFixed(2)} ms`,
  );
  console.log(
    `ramasse-miettes : ${String(snapshot.gc.count)} pauses (${String(snapshot.gc.majorCount)} majeures), ` +
      `${snapshot.gc.totalMs.toFixed(0)} ms cumules soit ${(snapshot.gc.ratio * 100).toFixed(1)} % de la fenetre, ` +
      `plus longue ${snapshot.gc.maxMs.toFixed(1)} ms`,
  );
  console.log(
    `processeur serveur : ${(snapshot.process.cpuRatio * 100).toFixed(0)} % d un coeur — ` +
      `rss ${String(snapshot.process.rssMb)} Mio, tas ${String(snapshot.process.heapUsedMb)} Mio`,
  );
  console.log(
    `clients : ${String(sentTotal)} messages envoyes (${(sentTotal / windowSeconds).toFixed(0)}/s), ` +
      `recus par le serveur ${String(total.count)} — ecart ${(((sentTotal - total.count) / Math.max(1, sentTotal)) * 100).toFixed(1)} %`,
  );
  console.log(
    `aller-retour du temoin (un client seul, processus inoccupe) : ` +
      `mediane ${load.witnessRtt.p50Ms.toFixed(1)} ms, p95 ${load.witnessRtt.p95Ms.toFixed(1)} ms, ` +
      `max ${load.witnessRtt.maxMs.toFixed(1)} ms sur ${String(load.witnessRtt.count)} mesures`,
  );
  const connect = workers.map((stats) => stats.connect);
  console.log(
    `connexion : mediane ${Math.max(...connect.map((c) => c.p50Ms)).toFixed(0)} ms, ` +
      `p95 ${Math.max(...connect.map((c) => c.p95Ms)).toFixed(0)} ms, ` +
      `max ${Math.max(...connect.map((c) => c.maxMs)).toFixed(0)} ms — ` +
      `${String(workers.reduce((sum, stats) => sum + stats.connectRetries, 0))} reprises`,
  );
  for (const [index, stats] of workers.entries()) {
    console.log(
      `  client ${String(index)} : retard de boucle p99 ${stats.loopLagP99Ms.toFixed(1)} ms, ` +
        `lots de taps en retard p95 ${stats.tapLateness.p95Ms.toFixed(1)} ms, ` +
        `aller-retour p95 ${stats.rtt.p95Ms.toFixed(1)} ms`,
    );
  }
  console.log(
    `charge machine : ${load.loadBefore.toFixed(2)} avant, ${load.loadAfter.toFixed(2)} apres`,
  );

  const rounds = workers.reduce((sum, stats) => sum + stats.roundsPlayed, 0);
  const ended = workers.reduce((sum, stats) => sum + stats.matchesEnded, 0);
  const disconnects = workers.reduce((sum, stats) => sum + stats.disconnects, 0);
  console.log(
    `\njeu : ${String(rounds / 2)} manches jouees, ${String(ended / 2)} matchs termines, ` +
      `${String(disconnects)} deconnexions`,
  );
  console.log(
    `anomalies : ${String(snapshot.messages.rejected)} messages refuses, ` +
      `${String(snapshot.messages.unsettled)} traces evincees, ${String(snapshot.unmatched)} non appariees`,
  );
  if (Object.keys(errors).length > 0) {
    console.log(`erreurs recues par les clients : ${JSON.stringify(errors)}`);
  }
}

main().catch((cause: unknown) => {
  console.error(cause instanceof Error ? cause.message : String(cause));
  process.exitCode = 1;
});
