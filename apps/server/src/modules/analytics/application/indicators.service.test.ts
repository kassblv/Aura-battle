import { describe, expect, it } from 'vitest';
import type { IndicatorReadings } from '../domain/indicators.js';
import { INDICATORS_CACHE_MS, IndicatorsService } from './indicators.service.js';

const READINGS: IndicatorReadings = {
  indicators: {
    retentionD1: { value: 0.4, n: 50 },
    retentionD7: { value: 0.05, n: 30 },
    matchesPerActiveDay: { value: 5.5, n: 120 },
    medianRankedWaitMs: { value: 31_000, n: 90 },
    clipShareRate: { value: 0.1, n: 5 },
    inviteInstallShare: { value: null, n: 0 },
    abandonRate: { value: 0.02, n: 400 },
  },
  ghostShare: { value: 0.3, n: 400 },
};

/**
 * Huit agregats sur toute la base a chaque lecture : le rapport se garde une
 * minute. Les valeurs bougent a l'echelle du jour ; un panneau ouvert dans
 * trois onglets, ou une boucle sur la route, ne doit pas les recalculer.
 */
function setup(read: () => Promise<IndicatorReadings> = () => Promise.resolve(READINGS)) {
  let nowMs = Date.UTC(2026, 8, 26, 9, 30);
  let reads = 0;
  const service = new IndicatorsService({
    reader: {
      read: () => {
        reads += 1;
        return read();
      },
    },
    clock: { now: () => new Date(nowMs) },
  });
  return {
    service,
    reads: () => reads,
    advance: (ms: number) => {
      nowMs += ms;
    },
  };
}

describe('IndicatorsService — rapport garde une minute', () => {
  it('ne recalcule pas une lecture rapprochee', async () => {
    const { service, reads, advance } = setup();
    await service.report();
    advance(INDICATORS_CACHE_MS - 1);
    await service.report();
    expect(reads()).toBe(1);
  });

  it('recalcule une fois la minute passee', async () => {
    const { service, reads, advance } = setup();
    await service.report();
    advance(INDICATORS_CACHE_MS);
    await service.report();
    expect(reads()).toBe(2);
  });

  it('fait partager le calcul en cours aux lectures simultanees', async () => {
    const { service, reads } = setup();
    await Promise.all([service.report(), service.report(), service.report()]);
    expect(reads()).toBe(1);
  });

  it('ne garde pas un echec', async () => {
    let fail = true;
    const { service, reads } = setup(() =>
      fail ? Promise.reject(new Error('base injoignable')) : Promise.resolve(READINGS),
    );
    await expect(service.report()).rejects.toThrow('base injoignable');
    fail = false;
    await expect(service.report()).resolves.toBeDefined();
    expect(reads()).toBe(2);
  });
});

/*
  Une horloge serveur qui recule (resynchronisation NTP) rendait l'age du
  rapport negatif — donc « frais » tout le temps du recul.
*/
describe('IndicatorsService — horloge qui recule', () => {
  it('recalcule plutot que de servir un rapport venu du futur', async () => {
    const { service, reads, advance } = setup();
    await service.report();
    advance(-10 * 60_000);
    await service.report();
    expect(reads()).toBe(2);
  });
});
