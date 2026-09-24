import { describe, expect, it } from 'vitest';
import { animationPrice } from './pricing.js';
import {
  allAnimationIds,
  animationId,
  animationIdsFor,
  animationsFor,
  defaultAnimationFor,
  MOVE_ANIMATIONS,
  moveOfAnimation,
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

  it('compte 39 poses : 25 offertes, une par case, et 14 variantes', () => {
    const total = STYLES.flatMap((style) =>
      TIERS.flatMap((tier) => animationsFor({ style, tier })),
    ).length;
    expect(total).toBe(39);
  });

  /**
   * Une aura battle est un echange : chaque famille doit offrir de quoi
   * varier. Les trois familles historiques gardent leurs variantes ; les deux
   * nouvelles partent d une pose offerte par case, et leurs variantes viendront
   * avec la boutique (chantier n°5).
   */
  it('compte les poses de chaque famille', () => {
    const perFamily = Object.fromEntries(
      STYLES.map((style) => [style, TIERS.flatMap((tier) => animationsFor({ style, tier })).length]),
    );
    expect(perFamily).toEqual({ calme: 10, hype: 8, provoc: 11, acrobatie: 5, prouesse: 5 });
  });

  /** Chaque palier a au moins un cosmetique a cote de son animation offerte. */
  it('propose un cosmetique sur chaque palier', () => {
    for (const tier of TIERS) {
      const cosmetics = STYLES.flatMap((style) => animationsFor({ style, tier }).slice(1));
      expect(cosmetics.length, `palier ${String(tier)}`).toBeGreaterThan(0);
    }
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
    const pattern = /^anim\.(calme|hype|provoc|acrobatie|prouesse|system)\.(t[0-4]|none)\.[a-z0-9-]+$/;
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

  it('rend 44 identifiants uniques au total', () => {
    const ids = allAnimationIds();
    expect(ids).toHaveLength(39 + SYSTEM_ANIMATIONS.length);
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
    const move = { style: 'calme', tier: 3 } as const;
    expect(animationIdsFor(move)).toEqual([
      'anim.calme.t3.meditate',
      'anim.calme.t3.moonwalk',
      'anim.calme.t3.slowkick',
    ]);
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

describe('cinq familles', () => {
  it('dans l ordre du cercle', () => {
    expect(STYLES).toEqual(['calme', 'hype', 'provoc', 'acrobatie', 'prouesse']);
  });

  it('chaque case a exactement une pose gratuite, la premiere', () => {
    for (const style of STYLES) {
      for (const tier of TIERS) {
        const ids = animationIdsFor({ style, tier });
        expect(ids.length).toBeGreaterThan(0);
        expect(ids[0]).toBe(defaultAnimationFor({ style, tier }));
        const free = ids.filter((id) => animationPrice(id, 'common') === 0);
        expect(free).toEqual([ids[0]]);
      }
    }
  });

  it('retrouve le mouvement d une pose', () => {
    expect(moveOfAnimation('anim.acrobatie.t2.wheel')).toEqual({ style: 'acrobatie', tier: 2 });
    expect(moveOfAnimation('anim.prouesse.t0.flex')).toEqual({ style: 'prouesse', tier: 0 });
  });

  it('refuse ce qui n est pas une pose de mouvement', () => {
    expect(moveOfAnimation('anim.system.none.victory')).toBeNull();
    expect(moveOfAnimation('fx.flames')).toBeNull();
    // ancien identifiant, avant que la roue ne change de famille
    expect(moveOfAnimation('anim.hype.t4.wheel')).toBeNull();
    expect(moveOfAnimation('')).toBeNull();
  });
});
