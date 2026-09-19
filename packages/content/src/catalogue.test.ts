import { describe, expect, it } from 'vitest';
import {
  allAnimationIds,
  animationId,
  animationIdsFor,
  animationsFor,
  defaultAnimationFor,
  MOVE_ANIMATIONS,
  STYLES,
  SYSTEM_ANIMATIONS,
  systemAnimationId,
  TIERS,
} from './catalogue.js';

describe('MOVE_ANIMATIONS', () => {
  it('couvre les quinze mouvements du jeu', () => {
    for (const style of STYLES) {
      for (const tier of TIERS) {
        expect(animationsFor({ style, tier }).length).toBeGreaterThan(0);
      }
    }
  });

  it('porte les 21 animations de mouvement du prototype', () => {
    const total = STYLES.flatMap((style) =>
      TIERS.flatMap((tier) => animationsFor({ style, tier })),
    ).length;
    expect(total).toBe(21);
  });

  it('n utilise jamais deux fois le meme slug', () => {
    const slugs = STYLES.flatMap((style) =>
      TIERS.flatMap((tier) => animationsFor({ style, tier })),
    );
    expect(new Set(slugs).size).toBe(slugs.length);
  });

  it('est gele', () => {
    expect(Object.isFrozen(MOVE_ANIMATIONS)).toBe(true);
  });
});

describe('identifiants', () => {
  it('suit la convention de nommage du schema', () => {
    const pattern = /^anim\.(calme|hype|provoc|system)\.(t[0-4]|none)\.[a-z0-9-]+$/;
    for (const id of allAnimationIds()) {
      expect(id).toMatch(pattern);
    }
  });

  it('compose l identifiant d un mouvement', () => {
    expect(animationId({ style: 'hype', tier: 1 }, 'sixseven')).toBe('anim.hype.t1.sixseven');
  });

  it('compose l identifiant d une animation systeme', () => {
    expect(systemAnimationId('victory')).toBe('anim.system.none.victory');
  });

  it('rend 26 identifiants uniques au total', () => {
    const ids = allAnimationIds();
    expect(ids).toHaveLength(21 + SYSTEM_ANIMATIONS.length);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('defaultAnimationFor', () => {
  it('rend la premiere animation de la case, celle qui est offerte', () => {
    expect(defaultAnimationFor({ style: 'calme', tier: 3 })).toBe('anim.calme.t3.meditate');
    expect(defaultAnimationFor({ style: 'provoc', tier: 1 })).toBe('anim.provoc.t1.point');
  });

  it('rend une animation pour chacun des quinze mouvements', () => {
    for (const style of STYLES) {
      for (const tier of TIERS) {
        expect(defaultAnimationFor({ style, tier })).toContain(`anim.${style}.t${tier}.`);
      }
    }
  });
});

describe('animationIdsFor', () => {
  it('rend des identifiants complets, la ou animationsFor rend des slugs', () => {
    const move = { style: 'calme', tier: 4 } as const;
    expect(animationIdsFor(move)).toEqual(['anim.calme.t4.levitate', 'anim.calme.t4.backflip']);
  });

  /**
   * Le piege que cette fonction existe pour fermer : compare a la sortie de
   * `defaultAnimationFor`, une liste de slugs ne donne jamais d'egalite.
   */
  it('contient toujours l animation offerte du mouvement', () => {
    for (const style of STYLES) {
      for (const tier of TIERS) {
        const move = { style, tier };
        expect(animationIdsFor(move)).toContain(defaultAnimationFor(move));
      }
    }
  });
});
