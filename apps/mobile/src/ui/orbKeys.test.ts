import { describe, expect, it } from 'vitest';
import { ORB_KEYS, orbKey, pressedOrb } from './orbKeys.js';

describe('orbKey', () => {
  it('rend une touche de la reserve', () => {
    expect(ORB_KEYS).toContain(orbKey({ x: 0.3, y: 0.7 }, new Set()));
  });

  it('ne donne jamais une touche deja portee par une autre orbe', () => {
    for (let i = 0; i < 500; i += 1) {
      const orb = { x: (i * 0.137) % 1, y: (i * 0.291) % 1 };
      const taken = new Set(ORB_KEYS.slice(0, i % ORB_KEYS.length));
      expect(taken.has(orbKey(orb, taken))).toBe(false);
    }
  });

  it('depend de la position, pas du rang : aucune suite a apprendre par coeur', () => {
    // Deux manches ont les memes rangs 0, 1, 2… mais pas les memes positions.
    const keys = new Set<string>();
    for (let i = 0; i < 60; i += 1) {
      keys.add(orbKey({ x: (i * 0.618) % 1, y: (i * 0.414) % 1 }, new Set()));
    }
    expect(keys.size).toBe(ORB_KEYS.length);
  });

  it('est deterministe', () => {
    const orb = { x: 0.42, y: 0.13 };
    expect(orbKey(orb, new Set(['s']))).toBe(orbKey(orb, new Set(['s'])));
  });
});

describe('pressedOrb', () => {
  const slotKeys = ['s', 'k', null] as const;
  const slotOrbs = [4, 7, null] as const;

  it('vise l orbe qui porte la touche', () => {
    expect(pressedOrb('k', slotKeys, slotOrbs)).toEqual({ orbIndex: 7 });
  });

  it('ignore la casse : Maj enfoncee ou verrouillee', () => {
    expect(pressedOrb('S', slotKeys, slotOrbs)).toEqual({ orbIndex: 4 });
  });

  it('une touche de la reserve sans orbe est un tap dans le vide', () => {
    expect(pressedOrb('d', slotKeys, slotOrbs)).toEqual({ orbIndex: null });
  });

  it('une touche hors reserve ne compte pas', () => {
    expect(pressedOrb('a', slotKeys, slotOrbs)).toBeNull();
    expect(pressedOrb('Enter', slotKeys, slotOrbs)).toBeNull();
  });

  it('un emplacement vide ne garde pas sa touche', () => {
    expect(pressedOrb('s', ['s', null, null], [null, null, null])).toEqual({ orbIndex: null });
  });
});
