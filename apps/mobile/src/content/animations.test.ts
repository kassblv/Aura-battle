import { allAnimationIds, systemAnimationId, SYSTEM_ANIMATIONS } from '@aura/content';
import { describe, expect, it } from 'vitest';
import { ANIMATIONS, animationFor, systemAnimation } from './animations.js';

describe('ANIMATIONS', () => {
  it('embarque toutes les animations du catalogue', () => {
    // Le catalogue annonce des identifiants ; ce test verifie que le fichier
    // existe vraiment derriere chacun. Sans lui, un mouvement se decouvre
    // manquant en plein match, a la revelation.
    for (const id of allAnimationIds()) {
      expect(ANIMATIONS.get(id), id).toBeDefined();
    }
  });

  it('ne transporte rien que le catalogue ignore', () => {
    const known = new Set(allAnimationIds());
    for (const id of ANIMATIONS.keys()) expect(known.has(id), id).toBe(true);
  });

  it('charge des documents valides, pas du JSON brut', () => {
    for (const [id, animation] of ANIMATIONS) {
      expect(animation.id, id).toBe(id);
      expect(animation.frames.length).toBeGreaterThan(0);
      expect(animation.loop.duration).toBeGreaterThan(0);
    }
  });
});

describe('animationFor', () => {
  it('rend l animation offerte d un mouvement', () => {
    const animation = animationFor({ style: 'hype', tier: 3 });
    expect(animation.move.style).toBe('hype');
    expect(animation.move.tier).toBe(3);
  });

  it('rend une animation pour chaque mouvement du jeu', () => {
    for (const style of ['calme', 'hype', 'provoc'] as const) {
      for (const tier of [0, 1, 2, 3, 4] as const) {
        expect(() => animationFor({ style, tier })).not.toThrow();
      }
    }
  });

  it('joue le skin demande quand il existe, et l offert sinon', () => {
    const offered = animationFor({ style: 'calme', tier: 4 });
    const chosen = animationFor({ style: 'calme', tier: 4 }, 'anim.calme.t4.backflip');
    expect(chosen.id).toBe('anim.calme.t4.backflip');
    // Un cosmetique absent ne doit jamais faire echouer une manche : on
    // retombe sur l animation offerte, strictement equivalente au score.
    expect(animationFor({ style: 'calme', tier: 4 }, 'anim.inconnue').id).toBe(offered.id);
  });

  it('refuse un skin d un autre mouvement', () => {
    // Porter l animation d un palier 4 sur un palier 0 serait un mensonge
    // visuel sur ce que l adversaire vient de depenser.
    const offered = animationFor({ style: 'calme', tier: 0 });
    expect(animationFor({ style: 'calme', tier: 0 }, 'anim.calme.t4.backflip').id).toBe(offered.id);
  });
});

describe('systemAnimation', () => {
  it('rend les poses hors mouvement a partir de leur slug', () => {
    // Le catalogue les nomme par slug ; l identifiant complet se construit.
    for (const slug of SYSTEM_ANIMATIONS) {
      expect(systemAnimation(slug).id).toBe(systemAnimationId(slug));
    }
  });
});
