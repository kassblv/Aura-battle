import { describe, expect, it } from 'vitest';
import { opponentOf } from './types.js';

describe('opponentOf', () => {
  it('renvoie l autre siege', () => {
    expect(opponentOf('a')).toBe('b');
    expect(opponentOf('b')).toBe('a');
  });

  it('est une involution', () => {
    expect(opponentOf(opponentOf('a'))).toBe('a');
    expect(opponentOf(opponentOf('b'))).toBe('b');
  });
});
