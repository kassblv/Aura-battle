import { describe, expect, it } from 'vitest';
import { PROTOCOL_VERSION } from './index.js';

describe('@aura/protocol', () => {
  it('expose une version de protocole entiere et positive', () => {
    expect(Number.isInteger(PROTOCOL_VERSION)).toBe(true);
    expect(PROTOCOL_VERSION).toBeGreaterThan(0);
  });
});
