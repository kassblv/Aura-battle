import { describe, expect, it } from 'vitest';
import type { ExperimentCohort, ExperimentGroupReading } from '../domain/experiments.js';
import { EXPERIMENTS_CACHE_MS, ExperimentsService } from './experiments.service.js';

const reading = (players: number): ExperimentGroupReading => ({
  players,
  retentionD1: { value: 0.4, n: players },
  retentionD7: { value: null, n: 0 },
  matchesPerActiveDay: { value: 3, n: players },
  abandonRate: { value: 0.1, n: 10 },
});

function build(start = Date.UTC(2026, 8, 26, 9)) {
  let now = start;
  const calls: { nowMs: number; cohort: ExperimentCohort }[] = [];
  let failNext = false;
  const service = new ExperimentsService({
    reader: {
      readCohort: (nowMs, cohort) => {
        calls.push({ nowMs, cohort });
        if (failNext) {
          failNext = false;
          return Promise.reject(new Error('base indisponible'));
        }
        return Promise.resolve(reading(cohort.group === 'treatment' ? 12 : 11));
      },
    },
    experiments: { declared: () => [{ flag: 'intentBubble', rollout: 50 }] },
    clock: { now: () => new Date(now) },
  });
  return {
    service,
    calls,
    advance: (ms: number) => (now += ms),
    failOnce: () => (failNext = true),
  };
}

describe('ExperimentsService', () => {
  it('lit chaque groupe de chaque experience declaree, a l heure serveur', async () => {
    const { service, calls } = build();
    const report = await service.report();

    expect(report).toEqual({
      at: '2026-09-26T09:00:00.000Z',
      experiments: [
        {
          flag: 'intentBubble',
          rollout: 50,
          groups: { treatment: reading(12), control: reading(11) },
        },
      ],
    });
    expect(calls.map((c) => c.cohort)).toEqual([
      { flag: 'intentBubble', group: 'treatment' },
      { flag: 'intentBubble', group: 'control' },
    ]);
    expect(new Set(calls.map((c) => c.nowMs))).toEqual(new Set([Date.UTC(2026, 8, 26, 9)]));
  });

  it('garde le rapport une minute, puis recalcule', async () => {
    const { service, calls, advance } = build();
    await service.report();
    advance(EXPERIMENTS_CACHE_MS - 1);
    await service.report();
    expect(calls).toHaveLength(2);
    advance(1);
    await service.report();
    expect(calls).toHaveLength(4);
  });

  it('ne garde pas un echec', async () => {
    const { service, calls, failOnce } = build();
    failOnce();
    await expect(service.report()).rejects.toThrow('base indisponible');
    await service.report();
    expect(calls.length).toBeGreaterThanOrEqual(3);
  });

  it('recalcule si l horloge recule', async () => {
    const { service, calls, advance } = build();
    await service.report();
    advance(-1_000);
    await service.report();
    expect(calls).toHaveLength(4);
  });
});
