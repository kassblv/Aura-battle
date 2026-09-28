import { RULE_VARIANTS, variantForWeek, weekIndexOf } from '@aura/rules';
import { adminEventsResponseSchema, weekEventSchema } from '@aura/protocol';
import { describe, expect, it, vi } from 'vitest';
import type { AdminAuditEntry } from '../../../shared/admin-audit.js';
import type { RuleEventStore } from '../domain/ports.js';
import {
  InvalidEventOverrideError,
  RULE_EVENTS_REFRESH_MS,
  RuleEventsService,
} from './rule-events.service.js';

class MemoryEvents implements RuleEventStore {
  readonly rows = new Map<number, string>();
  readonly audits: AdminAuditEntry[] = [];
  loads: number[] = [];
  failure: Error | null = null;

  loadFrom(fromWeek: number): Promise<ReadonlyMap<number, string>> {
    this.loads.push(fromWeek);
    if (this.failure !== null) return Promise.reject(this.failure);
    return Promise.resolve(new Map([...this.rows].filter(([week]) => week >= fromWeek)));
  }

  setOverride(
    week: number,
    variant: string | null,
    audit: (before: string | null) => AdminAuditEntry,
  ): Promise<void> {
    const entry = audit(this.rows.get(week) ?? null);
    if (variant === null) this.rows.delete(week);
    else this.rows.set(week, variant);
    this.audits.push(entry);
    return Promise.resolve();
  }
}

/** Samedi 26 septembre 2026, 15 h UTC. */
const NOW = Date.UTC(2026, 8, 26, 15);
const WEEK = weekIndexOf(NOW);

const build = (store = new MemoryEvents()) => ({
  store,
  service: new RuleEventsService({ store, clock: { now: () => NOW } }),
});

describe('RuleEventsService', () => {
  it('sans forcage lu, la rotation : aucun forcage connu', () => {
    const { service } = build();
    expect(service.overrideFor(WEEK)).toBeNull();
    expect(service.playerWeek()).toEqual({
      week: WEEK,
      variant: variantForWeek(WEEK),
      endsAt: service.playerWeek().endsAt,
    });
  });

  it('suit les forcages lus en base, a partir de la semaine en cours', async () => {
    const { store, service } = build();
    store.rows.set(WEEK, 'contres');
    await service.refresh();
    expect(store.loads).toEqual([WEEK]);
    expect(service.overrideFor(WEEK)).toBe('contres');
    expect(service.playerWeek().variant).toBe('contres');
    expect(weekEventSchema.safeParse(service.playerWeek()).success).toBe(true);
  });

  it('vue du panneau : semaine en cours et quatre suivantes, et les variantes forcables', async () => {
    const { store, service } = build();
    store.rows.set(WEEK + 2, 'normal');
    await service.refresh();
    const view = service.adminView();
    expect(adminEventsResponseSchema.safeParse(view).success).toBe(true);
    expect(view.weeks.map((week) => week.week)).toEqual([
      WEEK,
      WEEK + 1,
      WEEK + 2,
      WEEK + 3,
      WEEK + 4,
    ]);
    expect(view.weeks[2]).toMatchObject({ variant: 'normal', source: 'override' });
    expect(view.weeks[1]).toMatchObject({
      variant: variantForWeek(WEEK + 1),
      source: 'rotation',
    });
    expect(view.variants).toEqual([
      { id: 'normal', name: 'Normale' },
      ...RULE_VARIANTS.map((variant) => ({ id: variant.id, name: variant.name })),
    ]);
  });

  it('force une semaine, journalise avant et apres, et vaut aussitot sur ce noeud', async () => {
    const { store, service } = build();
    await service.setOverride(WEEK + 1, 'ultime', 'semaine du salon');
    expect(service.overrideFor(WEEK + 1)).toBe('ultime');
    expect(store.audits).toEqual([
      {
        action: 'event.override',
        target: `week:${String(WEEK + 1)}`,
        before: { variant: null },
        after: { variant: 'ultime' },
        reason: 'semaine du salon',
        atMs: NOW,
      },
    ]);

    await service.setOverride(WEEK + 1, null, null);
    expect(service.overrideFor(WEEK + 1)).toBeNull();
    expect(store.audits[1]).toMatchObject({
      before: { variant: 'ultime' },
      after: { variant: null },
      reason: null,
    });
  });

  it('refuse une variante qui n existe pas, sans rien ecrire', async () => {
    const { store, service } = build();
    await expect(service.setOverride(WEEK, 'inventee', null)).rejects.toBeInstanceOf(
      InvalidEventOverrideError,
    );
    expect(store.audits).toEqual([]);
  });

  it('refuse une semaine passee ou trop lointaine', async () => {
    const { store, service } = build();
    await expect(service.setOverride(WEEK - 1, 'normal', null)).rejects.toBeInstanceOf(
      InvalidEventOverrideError,
    );
    await expect(service.setOverride(WEEK + 53, 'normal', null)).rejects.toBeInstanceOf(
      InvalidEventOverrideError,
    );
    await expect(service.setOverride(WEEK + 0.5, 'normal', null)).rejects.toBeInstanceOf(
      InvalidEventOverrideError,
    );
    expect(store.audits).toEqual([]);
  });

  it('une lecture ratee garde les forcages connus', async () => {
    const { store, service } = build();
    store.rows.set(WEEK, 'brillance');
    await service.refresh();
    store.failure = new Error('base muette');
    await service.refresh();
    expect(service.overrideFor(WEEK)).toBe('brillance');
  });

  it('relit toutes les trente secondes une fois demarre, et s arrete', async () => {
    vi.useFakeTimers();
    try {
      const { store, service } = build();
      await service.onModuleInit();
      expect(store.loads).toHaveLength(1);
      store.rows.set(WEEK, 'contres');
      await vi.advanceTimersByTimeAsync(RULE_EVENTS_REFRESH_MS);
      expect(service.overrideFor(WEEK)).toBe('contres');
      service.onModuleDestroy();
      await vi.advanceTimersByTimeAsync(RULE_EVENTS_REFRESH_MS * 3);
      expect(store.loads).toHaveLength(2);
    } finally {
      vi.useRealTimers();
    }
  });
});

/* Meme course que pour les drapeaux : un rechargement perime n'efface pas un forcage. */
describe('RuleEventsService — un rechargement perime n ecrase pas une ecriture', () => {
  it('garde le forcage fait pendant le rechargement', async () => {
    const store = new MemoryEvents();
    let release: () => void = () => undefined;
    const slow = (fromWeek: number): Promise<ReadonlyMap<number, string>> => {
      const snapshot = new Map([...store.rows].filter(([week]) => week >= fromWeek));
      return new Promise((resolve) => {
        release = () => resolve(snapshot);
      });
    };
    const { service } = build(store);
    store.loadFrom = slow;
    const reloading = service.refresh();
    await service.setOverride(WEEK + 1, 'ultime', null);
    release();
    await reloading;
    expect(service.overrideFor(WEEK + 1)).toBe('ultime');
  });
});
