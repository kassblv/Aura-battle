import { describe, expect, it } from 'vitest';
import { clipTime, followClip, NO_CLIP } from './clip.js';

describe('followClip', () => {
  it('fait partir une nouvelle animation de zero', () => {
    const clip = followClip(NO_CLIP, 'anim.hype.t2.floss', 12.4);
    expect(clipTime(clip, 12.4, false, 1.7)).toBe(0);
    expect(clipTime(clip, 13, false, 1.7)).toBeCloseTo(0.6, 9);
  });

  it('ne repart pas tant que l animation reste la meme', () => {
    const first = followClip(NO_CLIP, 'anim.system.none.charge', 1);
    const again = followClip(first, 'anim.system.none.charge', 5);
    expect(again).toBe(first);
  });

  it('repart a chaque changement, retour compris', () => {
    const charge = followClip(NO_CLIP, 'anim.system.none.charge', 1);
    const dance = followClip(charge, 'anim.hype.t2.floss', 3);
    const back = followClip(dance, 'anim.system.none.charge', 6);
    expect(clipTime(back, 6, false, 0)).toBe(0);
  });

  it('decale seulement les poses d attente', () => {
    const clip = followClip(NO_CLIP, 'x', 2);
    expect(clipTime(clip, 2, true, 1.7)).toBeCloseTo(1.7, 9);
    expect(clipTime(clip, 2, false, 1.7)).toBe(0);
  });
});
