import { describe, expect, it } from 'vitest';
import { createOncePerMatch, KEYBOARD_QUERY, prefersKeys, rechargeInputMode } from './inputMode.js';

/** Un environnement simule : natif ou non, et ce que repond la media query. */
const env = (native: boolean, matches: boolean | null) => {
  const asked: string[] = [];
  return {
    asked,
    value: {
      native,
      matchMedia:
        matches === null
          ? null
          : (query: string) => {
              asked.push(query);
              return { matches };
            },
    },
  };
};

describe('prefersKeys — la recharge au clavier, sur ordinateur seulement', () => {
  it('interroge « survole, pointeur fin »', () => {
    const e = env(false, true);
    prefersKeys(e.value);
    expect(e.asked).toEqual([KEYBOARD_QUERY]);
    expect(KEYBOARD_QUERY).toBe('(hover: hover) and (pointer: fine)');
  });

  it('choisit le clavier sur un navigateur de bureau', () => {
    expect(prefersKeys(env(false, true).value)).toBe(true);
    expect(rechargeInputMode(env(false, true).value)).toBe('keys');
  });

  it('garde le doigt sur un ecran tactile', () => {
    expect(prefersKeys(env(false, false).value)).toBe(false);
    expect(rechargeInputMode(env(false, false).value)).toBe('touch');
  });

  it('garde le doigt dans l application native, meme si la media query dit « bureau »', () => {
    const e = env(true, true);
    expect(rechargeInputMode(e.value)).toBe('touch');
    expect(e.asked).toEqual([]);
  });

  it('suppose le doigt sans media query (tests, rendu hors navigateur)', () => {
    expect(rechargeInputMode(env(false, null).value)).toBe('touch');
  });
});

describe('createOncePerMatch — une mesure par match, jamais deux', () => {
  it('dit oui la premiere fois, non ensuite, pour chaque match', () => {
    const once = createOncePerMatch();
    expect(once('m_1')).toBe(true);
    expect(once('m_1')).toBe(false);
    expect(once('m_2')).toBe(true);
    expect(once('m_1')).toBe(false);
  });

  it('borne sa memoire : une longue session ne la fait pas grossir sans fin', () => {
    const once = createOncePerMatch(2);
    once('m_1');
    once('m_2');
    once('m_3');
    // m_1 est oublie : le serveur, lui, n'inscrirait de toute facon qu'une ligne.
    expect(once('m_3')).toBe(false);
    expect(once('m_1')).toBe(true);
  });
});
