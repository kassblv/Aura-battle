import { describe, expect, it } from 'vitest';
import { CONTENT_VERSION } from './index.js';

describe('@aura/content', () => {
  it('expose une version de catalogue', () => {
    expect(CONTENT_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
  });
});
