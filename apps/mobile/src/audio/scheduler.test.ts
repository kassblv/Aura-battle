import { describe, expect, it } from 'vitest';
import { DEFAULT_LIMITS, createSoundScheduler, type SchedulerLimits } from './scheduler.js';
import { voicesFor } from './sounds.js';
import { soundDuration } from './voices.js';

const limits = (overrides: Partial<SchedulerLimits> = {}): SchedulerLimits => ({
  ...DEFAULT_LIMITS,
  ...overrides,
});

describe('createSoundScheduler', () => {
  it('programme un son avec l avance qui evite le clic de depart', () => {
    const scheduler = createSoundScheduler(limits({ lead: 0.01 }));
    const scheduled = scheduler.schedule('lock', 5);
    expect(scheduled?.at).toBeCloseTo(5.01, 6);
    expect(scheduled?.name).toBe('lock');
    expect(scheduled?.voices).toEqual(voicesFor('lock'));
  });

  it('transmet le combo a la table de sons', () => {
    const scheduler = createSoundScheduler();
    const scheduled = scheduler.schedule('tap', 0, { combo: 8 });
    expect(scheduled?.voices).toEqual(voicesFor('tap', { combo: 8 }));
  });

  // Deux taps dans la meme image doublent le volume du son et le font claquer.
  it('refuse le meme son deux fois de suite trop vite', () => {
    const scheduler = createSoundScheduler(limits({ minGapSeconds: 0.05 }));
    expect(scheduler.schedule('tap', 0)).not.toBeNull();
    expect(scheduler.schedule('tap', 0.02)).toBeNull();
    expect(scheduler.schedule('tap', 0.06)).not.toBeNull();
  });

  it('ne fait pas taire un son a cause d un autre', () => {
    const scheduler = createSoundScheduler(limits({ minGapSeconds: 0.5 }));
    expect(scheduler.schedule('tap', 0)).not.toBeNull();
    expect(scheduler.schedule('tapGold', 0)).not.toBeNull();
  });

  it('abandonne un son plutot que de depasser le budget de voix', () => {
    const scheduler = createSoundScheduler(limits({ maxVoices: 4, minGapSeconds: 0 }));
    // Deux voix chacun : le troisieme ne rentre pas.
    expect(scheduler.schedule('land', 0)).not.toBeNull();
    expect(scheduler.schedule('lock', 0)).not.toBeNull();
    expect(scheduler.schedule('reveal', 0)).toBeNull();
  });

  it('libere le budget quand les voix ont fini de sonner', () => {
    const scheduler = createSoundScheduler(limits({ maxVoices: 2, minGapSeconds: 0 }));
    const premier = scheduler.schedule('land', 0);
    expect(premier).not.toBeNull();
    expect(scheduler.schedule('lock', 0.001)).toBeNull();

    const fin = (premier?.at ?? 0) + soundDuration(premier?.voices ?? []);
    expect(scheduler.activeVoices(fin + 0.001)).toBe(0);
    expect(scheduler.schedule('lock', fin + 0.001)).not.toBeNull();
  });

  it('compte les voix encore en train de sonner', () => {
    const scheduler = createSoundScheduler(limits({ minGapSeconds: 0 }));
    expect(scheduler.activeVoices(0)).toBe(0);
    scheduler.schedule('victory', 0);
    expect(scheduler.activeVoices(0.01)).toBe(voicesFor('victory').length);
  });

  // Apres une mise en arriere-plan, l horloge du contexte audio a saute :
  // les sons comptes comme actifs sont finis depuis longtemps.
  it('oublie tout apres une remise a zero', () => {
    const scheduler = createSoundScheduler(limits({ maxVoices: 2, minGapSeconds: 10 }));
    expect(scheduler.schedule('land', 0)).not.toBeNull();
    expect(scheduler.schedule('land', 0.5)).toBeNull();
    scheduler.reset();
    expect(scheduler.activeVoices(0.5)).toBe(0);
    expect(scheduler.schedule('land', 0.5)).not.toBeNull();
  });

  it('tient le budget sur une rafale d orbes', () => {
    const scheduler = createSoundScheduler();
    let now = 0;
    for (let i = 0; i < 200; i += 1) {
      scheduler.schedule('tap', now, { combo: i });
      scheduler.schedule('tapGold', now, { combo: i });
      now += 0.01;
      expect(scheduler.activeVoices(now)).toBeLessThanOrEqual(DEFAULT_LIMITS.maxVoices);
    }
  });

  it('garde un budget par defaut soutenable sur telephone', () => {
    expect(DEFAULT_LIMITS.maxVoices).toBeGreaterThan(8);
    expect(DEFAULT_LIMITS.maxVoices).toBeLessThanOrEqual(32);
    expect(DEFAULT_LIMITS.lead).toBeGreaterThan(0);
  });
});
