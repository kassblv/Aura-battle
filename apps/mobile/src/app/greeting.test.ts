import { describe, expect, it } from 'vitest';
import { markGreeted, wasGreeted } from './greeting.js';
import type { ProgressStore } from './persist.js';

const memory = (): ProgressStore & { value: string | null } => {
  const store = {
    value: null as string | null,
    read: () => store.value,
    write: (value: string) => {
      store.value = value;
    },
  };
  return store;
};

const broken: ProgressStore = {
  read: () => {
    throw new Error('stockage bloque');
  },
  write: () => {
    throw new Error('stockage bloque');
  },
};

describe('l accueil ne se represente pas a chaque lancement', () => {
  it('se souvient qu on l a passe', () => {
    const store = memory();
    expect(wasGreeted(store)).toBe(false);
    markGreeted(store);
    expect(wasGreeted(store)).toBe(true);
  });

  // Navigation privee, stockage bloque : le pire est de redemander, jamais de planter.
  it('survit a un stockage qui leve', () => {
    expect(wasGreeted(broken)).toBe(false);
    expect(() => {
      markGreeted(broken);
    }).not.toThrow();
  });
});
