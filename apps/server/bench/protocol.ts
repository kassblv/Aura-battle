/**
 * Dialogue entre l'orchestrateur du banc et ses processus clients (jalon M7).
 *
 * Les clients vivent dans des processus separes, et ce n'est pas un detail de
 * confort : mille sockets Socket.IO dans le processus du serveur lui
 * disputeraient sa boucle d'evenements, et la mesure dirait alors autant de
 * chose sur le banc que sur ce qu'il mesure.
 */

export interface BenchOptions {
  readonly httpUrl: string;
  readonly wsUrl: string;
  readonly pairing: 'invite' | 'queue';
  readonly tapBatchMs: number;
  readonly tapsPerSecond: number;
  readonly lockAtPct: number;
  readonly pingMs: number;
  /** Duree d'etalement de l'ouverture des matchs, en millisecondes. */
  readonly rampMs: number;
  /** Connexions ouvertes en parallele par processus client. */
  readonly connectConcurrency: number;
  readonly connectTimeoutMs: number;
  readonly connectAttempts: number;
}

export type DriverMessage =
  | {
      readonly type: 'prepare';
      readonly firstIndex: number;
      readonly matches: number;
      readonly options: BenchOptions;
    }
  | { readonly type: 'open' }
  | { readonly type: 'measure' }
  | { readonly type: 'collect' }
  | { readonly type: 'stop' };

export type WorkerMessage =
  /**
   * Avancement de la preparation.
   *
   * Sans lui, une montee en charge qui traine est indiscernable d'une montee
   * en charge bloquee : on attend dix minutes devant une ligne muette, puis on
   * abandonne sans savoir si c'etait l'ouverture des sessions ou celle des
   * sockets.
   */
  | {
      readonly type: 'progress';
      readonly phase: 'sessions' | 'sockets';
      readonly done: number;
      readonly total: number;
    }
  | { readonly type: 'prepared'; readonly players: number }
  | { readonly type: 'opened'; readonly matches: number }
  | { readonly type: 'stats'; readonly stats: WorkerStats }
  | { readonly type: 'failed'; readonly reason: string };

export interface WorkerStats {
  readonly players: number;
  readonly sent: Readonly<Record<string, number>>;
  readonly received: Readonly<Record<string, number>>;
  readonly errors: Readonly<Record<string, number>>;
  readonly matchesStarted: number;
  readonly matchesEnded: number;
  readonly roundsPlayed: number;
  readonly disconnects: number;
  readonly rtt: Percentiles;
  readonly tapLateness: Percentiles;
  /** Retard de la boucle du processus client : son propre temoin de fiabilite. */
  readonly loopLagP99Ms: number;
  /** Temps d'etablissement des connexions : la premiere chose qui casse. */
  readonly connect: Percentiles;
  /** Connexions ayant demande plus d'une tentative. */
  readonly connectRetries: number;
}

export interface Percentiles {
  readonly count: number;
  readonly meanMs: number;
  readonly p50Ms: number;
  readonly p95Ms: number;
  readonly p99Ms: number;
  readonly maxMs: number;
}

/**
 * Percentiles d'un echantillon, calcules par tri.
 *
 * Acceptable ici et pas dans le serveur : cote client on mesure des milliers
 * de valeurs, pas des centaines de milliers, et le calcul a lieu **apres** le
 * relevé — il ne peut plus rien perturber.
 */
export function percentilesOf(samples: readonly number[]): Percentiles {
  if (samples.length === 0) {
    return { count: 0, meanMs: 0, p50Ms: 0, p95Ms: 0, p99Ms: 0, maxMs: 0 };
  }
  const sorted = [...samples].sort((a, b) => a - b);
  const at = (p: number): number =>
    sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))]!;
  const sum = sorted.reduce((total, value) => total + value, 0);
  return {
    count: sorted.length,
    meanMs: round(sum / sorted.length),
    p50Ms: round(at(50)),
    p95Ms: round(at(95)),
    p99Ms: round(at(99)),
    maxMs: round(sorted[sorted.length - 1]!),
  };
}

function round(value: number): number {
  return Math.round(value * 1_000) / 1_000;
}
