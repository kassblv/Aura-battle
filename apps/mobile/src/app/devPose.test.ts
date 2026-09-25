import { describe, expect, it } from 'vitest';
import { devPoseFrom } from './devPose.js';

describe('devPoseFrom — la vitrine ouverte sur une pose, en developpement', () => {
  it('lit ?pose= en developpement', () => {
    expect(devPoseFrom('?pose=anim.prouesse.t0.flex', true)).toBe('anim.prouesse.t0.flex');
  });

  it('ne lit rien en production', () => {
    expect(devPoseFrom('?pose=anim.prouesse.t0.flex', false)).toBeNull();
  });

  it('ignore une adresse sans pose', () => {
    expect(devPoseFrom('', true)).toBeNull();
    expect(devPoseFrom('?pose=', true)).toBeNull();
  });
});
