import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { loadAnimation, type Animation } from './animation.js';
import {
  allAnimationIds,
  animationIdsFor,
  defaultAnimationFor,
  moveOfAnimation,
  STYLES,
  TIERS,
} from './catalogue.js';
import { animationPrice } from './pricing.js';
import type { Rarity } from './cosmetics.js';
import { ContentRegistry, ContentRegistryError, parseAnimationId } from './registry.js';

const root = fileURLToPath(new URL('../animations/', import.meta.url));
const bundled: Animation[] = readdirSync(root).flatMap((dir) =>
  readdirSync(`${root}${dir}`).map((file) =>
    loadAnimation(JSON.parse(readFileSync(`${root}${dir}/${file}`, 'utf8'))),
  ),
);

const byId = new Map(bundled.map((a) => [a.id, a]));
const withId = (id: string, rarity: string): Animation => ({
  ...byId.get('anim.hype.t0.dab')!,
  id,
  rarity,
});

/*
  Le registre remplace une liste ecrite en code (`MOVE_ANIMATIONS`) : ajouter
  une danse ne doit plus demander de TypeScript (regle d'or n° 5). Il doit
  d'abord rendre EXACTEMENT les memes reponses sur le contenu embarque.
*/
describe('ContentRegistry — equivalence avec le catalogue en code', () => {
  const registry = ContentRegistry.build(bundled);

  it.each(STYLES.flatMap((style) => TIERS.map((tier) => ({ style, tier }))))(
    '$style t$tier : memes poses, meme pose offerte',
    (move) => {
      expect(registry.animationIdsFor(move)).toEqual(animationIdsFor(move));
      expect(registry.defaultAnimationFor(move)).toBe(defaultAnimationFor(move));
    },
  );

  it('meme ensemble d identifiants, meme case pour chacun', () => {
    expect([...registry.allAnimationIds()].sort()).toEqual([...allAnimationIds()].sort());
    for (const id of allAnimationIds()) {
      expect(registry.moveOfAnimation(id)).toEqual(moveOfAnimation(id));
    }
  });

  it('memes prix', () => {
    for (const animation of bundled) {
      expect(registry.priceOf(animation.id)).toBe(
        animationPrice(animation.id, (animation.rarity ?? 'default') as Rarity),
      );
    }
  });
});

describe('ContentRegistry — invariants (regle d or n° 3)', () => {
  it('refuse une case sans pose offerte', () => {
    const sansOfferte = bundled.filter((a) => a.id !== 'anim.hype.t0.dab');
    expect(() => ContentRegistry.build(sansOfferte)).toThrow(ContentRegistryError);
  });

  it('refuse une case a deux poses offertes', () => {
    expect(() =>
      ContentRegistry.build([...bundled, withId('anim.hype.t0.dab2', 'default')]),
    ).toThrow(/hype t0/);
  });

  it('refuse un identifiant en double ou mal forme', () => {
    expect(() => ContentRegistry.build([...bundled, byId.get('anim.hype.t0.dab')!])).toThrow(
      /double/,
    );
    expect(() => ContentRegistry.build([...bundled, withId('danse-cool', 'rare')])).toThrow(
      /identifiant/,
    );
  });
});

describe('ContentRegistry — contenu publie', () => {
  const registry = ContentRegistry.build(bundled);

  it('ajoute une danse publiee a sa case, apres la pose offerte', () => {
    const next = registry.withPublished([withId('anim.hype.t0.wave', 'rare')]);
    expect(next.animationIdsFor({ style: 'hype', tier: 0 })).toEqual([
      'anim.hype.t0.dab',
      'anim.hype.t0.wave',
    ]);
    expect(next.moveOfAnimation('anim.hype.t0.wave')).toEqual({ style: 'hype', tier: 0 });
    expect(next.priceOf('anim.hype.t0.wave')).toBeGreaterThan(0);
    // Le registre d'origine est intact : chaque version est une valeur.
    expect(registry.animation('anim.hype.t0.wave')).toBeUndefined();
  });

  it('refuse qu une danse publiee remplace la pose offerte', () => {
    expect(() => registry.withPublished([withId('anim.hype.t0.wave', 'default')])).toThrow(
      /offerte/,
    );
  });

  it('refuse qu une danse publiee ecrase une danse embarquee', () => {
    expect(() => registry.withPublished([withId('anim.hype.t0.dab', 'rare')])).toThrow(/double/);
  });
});

describe('parseAnimationId', () => {
  it('lit la case dans l identifiant', () => {
    expect(parseAnimationId('anim.prouesse.t3.handstand')).toEqual({
      kind: 'move',
      move: { style: 'prouesse', tier: 3 },
      slug: 'handstand',
    });
    expect(parseAnimationId('anim.system.none.victory')).toEqual({
      kind: 'system',
      slug: 'victory',
    });
    expect(parseAnimationId('anim.danse.t9.x')).toBeNull();
    expect(parseAnimationId('anim.hype.t0.Pas Bon')).toBeNull();
  });
});
