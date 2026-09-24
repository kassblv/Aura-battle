import { describe, expect, it } from 'vitest';
import { allAnimationIds, AURA_EFFECTS, CONTENT_VERSION, defaultAnimationFor } from './index.js';

describe('@aura/content — surface publique', () => {
  it('expose une version de catalogue', () => {
    expect(CONTENT_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it('expose le catalogue des animations et des cosmetiques', () => {
    expect(allAnimationIds()).toHaveLength(44);
    expect(AURA_EFFECTS.length).toBeGreaterThan(0);
    expect(defaultAnimationFor({ style: 'hype', tier: 0 })).toBe('anim.hype.t0.dab');
  });
});
