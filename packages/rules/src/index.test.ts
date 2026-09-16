import { describe, expect, it } from 'vitest';
import { BALANCE, createRng, opponentOf, RULES_VERSION } from './index.js';

describe('@aura/rules — surface publique', () => {
  it('expose une version de moteur', () => {
    expect(RULES_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it('reexporte les valeurs d equilibrage, le RNG et les helpers de domaine', () => {
    expect(BALANCE.match.startingEnergy).toBe(14);
    expect(typeof createRng('g').nextFloat()).toBe('number');
    expect(opponentOf('a')).toBe('b');
  });
});
