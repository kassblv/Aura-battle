import { describe, expect, it } from 'vitest';
import { groupOf } from '../domain/flags.js';
import type { FlagAssignmentEntry, FlagAssignmentStore } from '../domain/ports.js';
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
    expect(flags.declared()).toEqual([{ flag: 'intentBubble', rollout: 0 }]);
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
      { playerId: 'p1', flag: 'intentBubble', group: 'treatment', atMs: NOW },
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
