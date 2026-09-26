import { describe, expect, it } from 'vitest';
import { bucketOf, FLAGS, groupOf, isRollout } from './flags.js';

/**
 * Affectation des joueurs aux groupes d'une experience (spec bulle
 * d'intention, § « Interrupteurs ») : pure, stable, et fidele a la part.
 */

describe('drapeaux declares en code', () => {
  it('declare la bulle d intention a 50 % par defaut', () => {
    expect(FLAGS.intentBubble.defaultRollout).toBe(50);
  });
});

describe('isRollout', () => {
  it.each([0, 1, 50, 100])('accepte %i', (value) => {
    expect(isRollout(value)).toBe(true);
  });
  it.each([-1, 101, 12.5, Number.NaN, Number.POSITIVE_INFINITY])('refuse %s', (value) => {
    expect(isRollout(value)).toBe(false);
  });
});

describe('bucketOf', () => {
  it('rend un entier de 0 a 99', () => {
    for (let i = 0; i < 500; i += 1) {
      const bucket = bucketOf('intentBubble', `p_${String(i)}`);
      expect(Number.isInteger(bucket)).toBe(true);
      expect(bucket).toBeGreaterThanOrEqual(0);
      expect(bucket).toBeLessThan(100);
    }
  });

  it('depend du drapeau : deux experiences ne tirent pas les memes groupes', () => {
    const ids = Array.from({ length: 200 }, (_, i) => `p_${String(i)}`);
    const same = ids.filter(
      (id) => bucketOf('intentBubble', id) === bucketOf('autre' as never, id),
    );
    // Independants : environ 1 % de coincidences, jamais toutes.
    expect(same.length).toBeLessThan(20);
  });
});

describe('groupOf', () => {
  it('rend toujours le meme groupe au meme joueur', () => {
    for (let i = 0; i < 200; i += 1) {
      const id = `joueur-${String(i)}`;
      const first = groupOf('intentBubble', id, 50);
      for (let k = 0; k < 3; k += 1) expect(groupOf('intentBubble', id, 50)).toBe(first);
    }
  });

  it('respecte la part a deux points pres sur 10 000 identifiants', () => {
    for (const rollout of [10, 50, 73]) {
      let treated = 0;
      for (let i = 0; i < 10_000; i += 1) {
        if (groupOf('intentBubble', `player-${String(i)}-x`, rollout) === 'treatment') treated += 1;
      }
      expect(Math.abs(treated / 100 - rollout)).toBeLessThanOrEqual(2);
    }
  });

  it('part 0 : personne n est expose', () => {
    for (let i = 0; i < 2_000; i += 1) {
      expect(groupOf('intentBubble', `z${String(i)}`, 0)).toBe('control');
    }
  });

  it('part 100 : tout le monde est expose', () => {
    for (let i = 0; i < 2_000; i += 1) {
      expect(groupOf('intentBubble', `z${String(i)}`, 100)).toBe('treatment');
    }
  });

  it('elargir la part garde les exposes exposes', () => {
    for (let i = 0; i < 1_000; i += 1) {
      const id = `w${String(i)}`;
      if (groupOf('intentBubble', id, 20) === 'treatment') {
        expect(groupOf('intentBubble', id, 60)).toBe('treatment');
      }
    }
  });
});
