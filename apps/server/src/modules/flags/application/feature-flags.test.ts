import { describe, expect, it, vi } from 'vitest';
import type { AdminAuditEntry } from '../../../shared/admin-audit.js';
import { groupOf, type FlagName, type FlagSettingState } from '../domain/flags.js';
import type {
  FlagAssignmentEntry,
  FlagAssignmentStore,
  FlagSettingsStore,
} from '../domain/ports.js';
import { FeatureFlags } from './feature-flags.js';

class MemoryStore implements FlagAssignmentStore {
  readonly entries: FlagAssignmentEntry[] = [];
  failure: Error | null = null;
  record(entry: FlagAssignmentEntry): Promise<void> {
    this.entries.push(entry);
    return this.failure === null ? Promise.resolve() : Promise.reject(this.failure);
  }
}

const NOW = Date.UTC(2026, 8, 26, 12);
const clock = { now: () => NOW };

describe('FeatureFlags', () => {
  it('affecte par le hachage, a la part configuree', () => {
    const flags = new FeatureFlags({ rollouts: { intentBubble: 37 }, clock });
    for (let i = 0; i < 300; i += 1) {
      const id = `p${String(i)}`;
      expect(flags.groupOf('intentBubble', id)).toBe(groupOf('intentBubble', id, 37));
    }
  });

  it('decrit les drapeaux declares avec leur part en vigueur', () => {
    const flags = new FeatureFlags({ rollouts: { intentBubble: 0 }, clock });
    expect(flags.declared()).toEqual([
      {
        flag: 'intentBubble',
        rollout: 0,
        measureRollout: 50,
        epoch: 1,
        measureStartedAtMs: NOW,
      },
    ]);
  });

  it('accepte une affectation injectee, pour les tests de bout en bout', () => {
    const flags = new FeatureFlags({
      rollouts: { intentBubble: 50 },
      clock,
      assign: (_flag, playerId) => (playerId.startsWith('ctl') ? 'control' : 'treatment'),
    });
    expect(flags.groupOf('intentBubble', 'ctl_1')).toBe('control');
    expect(flags.groupOf('intentBubble', 'trt_1')).toBe('treatment');
  });

  it('inscrit l affectation quand elle sert, sans attendre, a l heure serveur', () => {
    const store = new MemoryStore();
    const flags = new FeatureFlags({ rollouts: { intentBubble: 100 }, clock, store });

    expect(flags.enroll('intentBubble', 'p1')).toBe('treatment');
    expect(store.entries).toEqual([
      { playerId: 'p1', flag: 'intentBubble', group: 'treatment', epoch: 1, atMs: NOW },
    ]);
  });

  it('inscrit aussi le groupe temoin : c est lui qu on compare', () => {
    const store = new MemoryStore();
    const flags = new FeatureFlags({ rollouts: { intentBubble: 0 }, clock, store });
    expect(flags.enroll('intentBubble', 'p2')).toBe('control');
    expect(store.entries[0]?.group).toBe('control');
  });

  it('ne lit pas le groupe sans rien inscrire', () => {
    const store = new MemoryStore();
    const flags = new FeatureFlags({ rollouts: { intentBubble: 50 }, clock, store });
    flags.groupOf('intentBubble', 'p3');
    expect(store.entries).toEqual([]);
  });

  it('survit a une base qui refuse : le groupe est rendu, l echec journalise', async () => {
    const store = new MemoryStore();
    store.failure = new Error('base indisponible');
    const warnings: string[] = [];
    const flags = new FeatureFlags({
      rollouts: { intentBubble: 100 },
      clock,
      store,
      log: { warn: (message) => warnings.push(message) },
    });

    expect(flags.enroll('intentBubble', 'p4')).toBe('treatment');
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(warnings).toHaveLength(1);
    // Jamais l'identifiant du joueur : un journal ne doit pas defaire une
    // suppression de compte (voir prisma-match.repository.ts).
    expect(warnings[0]).not.toContain('p4');
    expect(warnings[0]).toContain('intentBubble');
  });

  /*
    La ligne existe des la premiere inscription : la reecrire a chaque match
    ferait croitre la charge en base avec le nombre de matchs, pas de joueurs.
  */
  it('n inscrit qu une fois par joueur et par drapeau', () => {
    const store = new MemoryStore();
    const flags = new FeatureFlags({ rollouts: { intentBubble: 100 }, clock, store });
    flags.enroll('intentBubble', 'p5');
    flags.enroll('intentBubble', 'p5');
    expect(store.entries).toHaveLength(1);
  });

  it('reessaie au match suivant si l inscription a echoue', async () => {
    const store = new MemoryStore();
    store.failure = new Error('base indisponible');
    const flags = new FeatureFlags({ rollouts: { intentBubble: 100 }, clock, store });
    flags.enroll('intentBubble', 'p6');
    await new Promise((resolve) => setTimeout(resolve, 0));
    store.failure = null;
    flags.enroll('intentBubble', 'p6');
    expect(store.entries).toHaveLength(2);
  });
});

/** Reglages en base, en memoire : la transition et le journal vont ensemble. */
class MemorySettings implements FlagSettingsStore {
  rows = new Map<FlagName, FlagSettingState>();
  readonly audits: AdminAuditEntry[] = [];
  loads = 0;
  failure: Error | null = null;

  loadAll(initial: readonly FlagSettingState[]): Promise<FlagSettingState[]> {
    this.loads += 1;
    if (this.failure !== null) return Promise.reject(this.failure);
    for (const state of initial) if (!this.rows.has(state.flag)) this.rows.set(state.flag, state);
    return Promise.resolve([...this.rows.values()]);
  }

  transition(
    flag: FlagName,
    next: (current: FlagSettingState) => FlagSettingState,
    audit: (before: FlagSettingState, after: FlagSettingState) => AdminAuditEntry,
  ): Promise<FlagSettingState> {
    const current = this.rows.get(flag);
    if (current === undefined) return Promise.reject(new Error('reglage absent'));
    const after = next(current);
    this.rows.set(flag, after);
    this.audits.push(audit(current, after));
    return Promise.resolve(after);
  }
}

describe('FeatureFlags, reglages en base (panneau qui gere)', () => {
  it('avant la premiere lecture des reglages, personne n est expose ni inscrit', () => {
    const store = new MemoryStore();
    const flags = new FeatureFlags({
      rollouts: { intentBubble: 100 },
      clock,
      store,
      settings: new MemorySettings(),
    });
    expect(flags.enroll('intentBubble', 'x1')).toBe('control');
    expect(store.entries).toEqual([]);
  });

  it('initialise les reglages absents depuis l environnement, epoque 1', async () => {
    const settings = new MemorySettings();
    const flags = new FeatureFlags({ rollouts: { intentBubble: 30 }, clock, settings });
    await flags.refresh();
    expect(settings.rows.get('intentBubble')).toEqual({
      flag: 'intentBubble',
      rollout: 30,
      measureRollout: 30,
      epoch: 1,
      measureStartedAtMs: NOW,
    });
    expect(flags.groupOf('intentBubble', 'y1')).toBe(groupOf('intentBubble', 'y1', 30, 1));
  });

  it('suit les reglages lus en base, epoque comprise, et inscrit l epoque', async () => {
    const settings = new MemorySettings();
    settings.rows.set('intentBubble', {
      flag: 'intentBubble',
      rollout: 40,
      measureRollout: 40,
      epoch: 3,
      measureStartedAtMs: NOW - 1_000,
    });
    const store = new MemoryStore();
    const flags = new FeatureFlags({ rollouts: { intentBubble: 90 }, clock, store, settings });
    await flags.refresh();
    for (let i = 0; i < 200; i += 1) {
      const id = `e${String(i)}`;
      expect(flags.groupOf('intentBubble', id)).toBe(groupOf('intentBubble', id, 40, 3));
    }
    flags.enroll('intentBubble', 'e1');
    expect(store.entries[0]).toMatchObject({ playerId: 'e1', epoch: 3 });
  });

  it('une nouvelle mesure re-inscrit un joueur deja inscrit a la precedente', async () => {
    const settings = new MemorySettings();
    const store = new MemoryStore();
    const flags = new FeatureFlags({ rollouts: { intentBubble: 50 }, clock, store, settings });
    await flags.refresh();
    flags.enroll('intentBubble', 'r1');
    await flags.update('intentBubble', { action: 'new-measure', rollout: 20 }, null);
    flags.enroll('intentBubble', 'r1');
    expect(store.entries.map((entry) => entry.epoch)).toEqual([1, 2]);
    expect(store.entries[1]?.group).toBe(groupOf('intentBubble', 'r1', 20, 2));
  });

  it('une ecriture passe par la transition, journalise, et vaut aussitot sur ce noeud', async () => {
    const settings = new MemorySettings();
    const flags = new FeatureFlags({ rollouts: { intentBubble: 50 }, clock, settings });
    await flags.refresh();

    const paused = await flags.update('intentBubble', { action: 'pause' }, 'incident en cours');
    expect(paused.rollout).toBe(0);
    for (let i = 0; i < 100; i += 1) {
      expect(flags.groupOf('intentBubble', `q${String(i)}`)).toBe('control');
    }
    expect(settings.audits).toEqual([
      {
        action: 'flag.pause',
        target: 'intentBubble',
        before: {
          rollout: 50,
          measureRollout: 50,
          epoch: 1,
          measureStartedAt: new Date(NOW).toISOString(),
        },
        after: {
          rollout: 0,
          measureRollout: 50,
          epoch: 1,
          measureStartedAt: new Date(NOW).toISOString(),
        },
        reason: 'incident en cours',
        atMs: NOW,
      },
    ]);

    const resumed = await flags.update('intentBubble', { action: 'resume' }, null);
    expect(resumed.rollout).toBe(50);
    expect(settings.audits[1]?.action).toBe('flag.resume');
    expect(settings.audits[1]?.reason).toBeNull();
  });

  it('une lecture ratee garde les derniers reglages connus', async () => {
    const settings = new MemorySettings();
    const warnings: string[] = [];
    const flags = new FeatureFlags({
      rollouts: { intentBubble: 100 },
      clock,
      settings,
      log: { warn: (message) => warnings.push(message) },
    });
    await flags.refresh();
    settings.failure = new Error('base muette');
    await flags.refresh();
    expect(flags.groupOf('intentBubble', 'k1')).toBe('treatment');
    expect(warnings).toHaveLength(1);
  });

  it('relit les reglages a intervalle regulier une fois demarre', async () => {
    vi.useFakeTimers();
    try {
      const settings = new MemorySettings();
      const flags = new FeatureFlags({ rollouts: { intentBubble: 50 }, clock, settings });
      await flags.onModuleInit();
      expect(settings.loads).toBe(1);
      // Un autre noeud a coupe le drapeau.
      settings.rows.set('intentBubble', { ...settings.rows.get('intentBubble')!, rollout: 0 });
      await vi.advanceTimersByTimeAsync(30_000);
      expect(settings.loads).toBe(2);
      expect(flags.declared()[0]?.rollout).toBe(0);
      flags.onModuleDestroy();
      await vi.advanceTimersByTimeAsync(60_000);
      expect(settings.loads).toBe(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it('refuse d ecrire sans reglages en base', async () => {
    const flags = new FeatureFlags({ rollouts: { intentBubble: 50 }, clock });
    await expect(flags.update('intentBubble', { action: 'pause' }, null)).rejects.toThrow();
  });
});

/*
  Relecture de securite : un rechargement lance AVANT une ecriture de ce noeud,
  et termine APRES, ecrasait le cache avec l'etat d'avant. Une coupure
  d'urgence (« pause ») pouvait ainsi rester sans effet jusqu'au rechargement
  suivant.
*/
describe('FeatureFlags — un rechargement perime n ecrase pas une ecriture', () => {
  class SlowSettings extends MemorySettings {
    private pending: (() => void) | null = null;
    slow = false;
    override loadAll(initial: readonly FlagSettingState[]): Promise<FlagSettingState[]> {
      if (!this.slow) return super.loadAll(initial);
      const snapshot = [...this.rows.values()].map((row) => ({ ...row }));
      return new Promise((resolve) => {
        this.pending = () => resolve(snapshot);
      });
    }
    release(): void {
      this.pending?.();
    }
  }

  it('garde la pause faite pendant le rechargement', async () => {
    const settings = new SlowSettings();
    const flags = new FeatureFlags({ rollouts: { intentBubble: 100 }, clock, settings });
    await flags.refresh();
    settings.slow = true;
    const reloading = flags.refresh();
    await flags.update('intentBubble', { action: 'pause' }, 'incident');
    settings.release();
    await reloading;
    expect(flags.groupOf('intentBubble', 'z1')).toBe('control');
  });
});
