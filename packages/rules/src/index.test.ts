import { describe, expect, it } from 'vitest';
import { opponentOf, RULES_VERSION } from './index.js';

describe('@aura/rules', () => {
  it('expose une version de moteur', () => {
    expect(RULES_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it('opponentOf est une involution', () => {
    expect(opponentOf('a')).toBe('b');
    expect(opponentOf('b')).toBe('a');
    expect(opponentOf(opponentOf('a'))).toBe('a');
  });
});
