import { describe, expect, it } from 'vitest';
import { VERDICT_PANEL_AT_MS } from '../arena/round.js';
import { scheduleVerdictRender, type Timers } from './verdictTimer.js';

/** Des minuteurs a la main : le test decide quand chacun tombe. */
function manualTimers(): Timers & { pending: { cb: () => void; ms: number }[] } {
  const pending: { cb: () => void; ms: number }[] = [];
  return {
    pending,
    set: (cb, ms) => {
      pending.push({ cb, ms });
      return pending.length;
    },
    clear: () => {
      pending.length = 0;
    },
  };
}

describe('scheduleVerdictRender', () => {
  it('rend a l instant du verdict, arrondi au-dessus', () => {
    const timers = manualTimers();
    let now = 100.3;
    let renders = 0;
    scheduleVerdictRender(
      () => ({ phase: 'reveal', inPhaseMs: now }),
      () => (renders += 1),
      timers,
    );
    expect(timers.pending[0]?.ms).toBeGreaterThanOrEqual(VERDICT_PANEL_AT_MS - 100.3);
    now = VERDICT_PANEL_AT_MS;
    timers.pending.shift()?.cb();
    expect(renders).toBe(1);
  });

  // Un minuteur peut tomber une fraction de milliseconde trop tot : sans
  // nouvelle tentative, le verdict de la manche ne s'afficherait jamais.
  it('reprogramme s il tombe trop tot', () => {
    const timers = manualTimers();
    let now = 0;
    let renders = 0;
    scheduleVerdictRender(
      () => ({ phase: 'reveal', inPhaseMs: now }),
      () => (renders += 1),
      timers,
    );
    now = VERDICT_PANEL_AT_MS - 0.5;
    timers.pending.shift()?.cb();
    expect(renders).toBe(0);
    expect(timers.pending).toHaveLength(1);
    now = VERDICT_PANEL_AT_MS;
    timers.pending.shift()?.cb();
    expect(renders).toBe(1);
  });

  it('ne programme rien hors revelation, et s annule', () => {
    const timers = manualTimers();
    scheduleVerdictRender(
      () => ({ phase: 'choice', inPhaseMs: 0 }),
      () => undefined,
      timers,
    );
    expect(timers.pending).toHaveLength(0);
    const stop = scheduleVerdictRender(
      () => ({ phase: 'reveal', inPhaseMs: 0 }),
      () => undefined,
      timers,
    );
    stop();
    expect(timers.pending).toHaveLength(0);
  });
});
