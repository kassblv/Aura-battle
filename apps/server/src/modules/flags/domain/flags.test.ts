import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { applyFlagAction, bucketOf, FLAGS, groupOf, initialFlagState, isRollout } from './flags.js';

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

/*
  Epoques (spec 2026-09-26, panneau qui gere) : une nouvelle mesure re-hache
  les groupes. L'epoque 1 garde EXACTEMENT le hachage d'avant les epoques, sans
  quoi chaque inscription deja faite changerait de groupe sous nos pieds.
*/
describe('epoques', () => {
  it('l epoque 1 garde le hachage historique `drapeau:joueur`', () => {
    const digest = (key: string): number =>
      createHash('sha256').update(key).digest().readUIntBE(0, 6) % 100;
    for (let i = 0; i < 300; i += 1) {
      const id = `hist-${String(i)}`;
      expect(bucketOf('intentBubble', id, 1)).toBe(digest(`intentBubble:${id}`));
      expect(bucketOf('intentBubble', id)).toBe(digest(`intentBubble:${id}`));
    }
  });

  it('une epoque suivante hache `drapeau#epoque:joueur`', () => {
    const digest = (key: string): number =>
      createHash('sha256').update(key).digest().readUIntBE(0, 6) % 100;
    for (let i = 0; i < 300; i += 1) {
      const id = `next-${String(i)}`;
      expect(bucketOf('intentBubble', id, 2)).toBe(digest(`intentBubble#2:${id}`));
      expect(bucketOf('intentBubble', id, 7)).toBe(digest(`intentBubble#7:${id}`));
    }
  });

  it('deux epoques tirent des groupes independants', () => {
    let same = 0;
    for (let i = 0; i < 2_000; i += 1) {
      const id = `ind-${String(i)}`;
      if (groupOf('intentBubble', id, 50, 1) === groupOf('intentBubble', id, 50, 2)) same += 1;
    }
    // Independants : environ la moitie, jamais tous.
    expect(same).toBeGreaterThan(850);
    expect(same).toBeLessThan(1_150);
  });
});

describe('applyFlagAction', () => {
  const AT = Date.UTC(2026, 8, 26, 10);
  const state = {
    flag: 'intentBubble' as const,
    rollout: 50,
    measureRollout: 50,
    epoch: 1,
    measureStartedAtMs: Date.UTC(2026, 8, 20),
  };

  it('pause : part 0, la mesure ne bouge pas', () => {
    expect(applyFlagAction(state, { action: 'pause' }, AT)).toEqual({ ...state, rollout: 0 });
  });

  it('resume : retrouve la part de la mesure en cours', () => {
    const paused = { ...state, rollout: 0 };
    expect(applyFlagAction(paused, { action: 'resume' }, AT)).toEqual(state);
  });

  it('new-measure : epoque suivante, nouvelle part, instant de depart', () => {
    expect(applyFlagAction(state, { action: 'new-measure', rollout: 20 }, AT)).toEqual({
      flag: 'intentBubble',
      rollout: 20,
      measureRollout: 20,
      epoch: 2,
      measureStartedAtMs: AT,
    });
  });

  it('refuse une part hors bornes', () => {
    expect(() => applyFlagAction(state, { action: 'new-measure', rollout: 0 }, AT)).toThrow();
    expect(() => applyFlagAction(state, { action: 'new-measure', rollout: 101 }, AT)).toThrow();
    expect(() => applyFlagAction(state, { action: 'new-measure', rollout: 2.5 }, AT)).toThrow();
  });
});

describe('initialFlagState', () => {
  it('part de l environnement, epoque 1 ; une part 0 garde une mesure rallumable', () => {
    const at = Date.UTC(2026, 8, 26);
    expect(initialFlagState('intentBubble', 30, at)).toEqual({
      flag: 'intentBubble',
      rollout: 30,
      measureRollout: 30,
      epoch: 1,
      measureStartedAtMs: at,
    });
    expect(initialFlagState('intentBubble', 0, at)).toMatchObject({
      rollout: 0,
      measureRollout: FLAGS.intentBubble.defaultRollout,
    });
  });
});
