import {
  EXPERIMENT_GROUPS,
  type ExperimentGroup,
  type ExperimentGroupReading,
  type ExperimentReport,
} from '../domain/experiments.js';
import type { Clock, DeclaredExperiments, ExperimentsReader } from '../domain/ports.js';

/**
 * Duree de vie du rapport, comme celle des indicateurs : des agregats sur toute
 * la base, qui bougent a l'echelle du jour.
 */
export const EXPERIMENTS_CACHE_MS = 60_000;

/**
 * Les tests A/B en cours, groupe par groupe (spec 2026-09-26).
 *
 * Lecture seule. Meme contrat de cache que `IndicatorsService` : une minute,
 * lectures simultanees partagees, echec jamais garde, horloge reculee =
 * recalcul.
 */
export class ExperimentsService {
  private readonly reader: ExperimentsReader;
  private readonly experiments: DeclaredExperiments;
  private readonly clock: Clock;
  private cached: {
    readonly atMs: number;
    /** Les mesures lues : une nouvelle mesure rend le rapport garde caduc. */
    readonly measures: string;
    readonly report: Promise<ExperimentReport>;
  } | null = null;

  constructor(deps: { reader: ExperimentsReader; experiments: DeclaredExperiments; clock: Clock }) {
    this.reader = deps.reader;
    this.experiments = deps.experiments;
    this.clock = deps.clock;
  }

  report(): Promise<ExperimentReport> {
    const nowMs = this.clock.now().getTime();
    const declared = this.experiments.declared();
    const measures = declared.map(({ flag, epoch }) => `${flag}#${String(epoch)}`).join(',');
    const age = this.cached === null ? -1 : nowMs - this.cached.atMs;
    if (
      this.cached !== null &&
      this.cached.measures === measures &&
      age >= 0 &&
      age < EXPERIMENTS_CACHE_MS
    ) {
      return this.cached.report;
    }
    const report = this.compute(nowMs, declared);
    const entry = { atMs: nowMs, measures, report };
    this.cached = entry;
    report.catch(() => {
      if (this.cached === entry) this.cached = null;
    });
    return report;
  }

  private async compute(
    nowMs: number,
    declared: ReturnType<DeclaredExperiments['declared']>,
  ): Promise<ExperimentReport> {
    const experiments = await Promise.all(
      declared.map(async ({ flag, rollout, epoch, measureStartedAtMs }) => {
        const readings = await Promise.all(
          EXPERIMENT_GROUPS.map((group) => this.reader.readCohort(nowMs, { flag, epoch, group })),
        );
        const groups = Object.fromEntries(
          EXPERIMENT_GROUPS.map((group, index) => [group, readings[index]!]),
        ) as Record<ExperimentGroup, ExperimentGroupReading>;
        return {
          flag,
          rollout,
          epoch,
          measureStartedAt: new Date(measureStartedAtMs).toISOString(),
          groups,
        };
      }),
    );
    return { at: new Date(nowMs).toISOString(), experiments };
  }
}
