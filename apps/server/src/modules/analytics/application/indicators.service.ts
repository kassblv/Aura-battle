import { buildIndicatorReport, type IndicatorReport } from '../domain/indicators.js';
import type { Clock, IndicatorsReader } from '../domain/ports.js';

/**
 * Duree de vie du rapport. Huit agregats sur toute la base a chaque calcul ;
 * les valeurs bougent a l'echelle du jour.
 */
export const INDICATORS_CACHE_MS = 60_000;

/**
 * Les indicateurs produit, a l'instant present (heure serveur).
 *
 * Lecture seule. Le calcul est fait par le lecteur (agregats en base), le
 * verdict par le domaine ; ce service ne fait que donner l'heure a l'un et le
 * resultat a l'autre — et garde ce resultat une minute (`INDICATORS_CACHE_MS`).
 * Les lectures simultanees partagent le calcul en cours ; un echec n'est pas
 * garde.
 */
export class IndicatorsService {
  private readonly reader: IndicatorsReader;
  private readonly clock: Clock;
  private cached: { readonly atMs: number; readonly report: Promise<IndicatorReport> } | null =
    null;

  constructor(deps: { reader: IndicatorsReader; clock: Clock }) {
    this.reader = deps.reader;
    this.clock = deps.clock;
  }

  report(): Promise<IndicatorReport> {
    const nowMs = this.clock.now().getTime();
    // Un age negatif (horloge serveur reculee) n'est pas « frais » : on recalcule.
    const age = this.cached === null ? -1 : nowMs - this.cached.atMs;
    if (this.cached !== null && age >= 0 && age < INDICATORS_CACHE_MS) {
      return this.cached.report;
    }
    const report = this.compute(nowMs);
    const entry = { atMs: nowMs, report };
    this.cached = entry;
    // Un echec ne se garde pas : la lecture suivante recalcule.
    report.catch(() => {
      if (this.cached === entry) this.cached = null;
    });
    return report;
  }

  private async compute(nowMs: number): Promise<IndicatorReport> {
    return buildIndicatorReport(await this.reader.read(nowMs), nowMs);
  }
}
