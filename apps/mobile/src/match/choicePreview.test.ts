import { animationIdsFor, defaultAnimationFor } from '@aura/content';
import { describe, expect, it } from 'vitest';
import { defaultLook, type Look } from '../app/wardrobe.js';
import { withChoicePreview, type ChoicePreview } from './choicePreview.js';
import type { Presentation } from './presentation.js';

/**
 * L apercu du choix : mon personnage prend la pose du mouvement que je
 * selectionne, et l aura de l amplificateur que je touche — sur MON ecran.
 *
 * Regle d or n°4 : rien de tout cela ne part au serveur, et l adversaire n en
 * voit rien. Ce que ces tests verrouillent, c est que l apercu ne touche
 * JAMAIS au rig d en face, et qu il ne survit pas a la phase de choix.
 */

const FLOSS = animationIdsFor({ style: 'hype', tier: 2 })[1]!;

const scene = (a: Look = defaultLook()): Presentation => ({
  fighters: {
    a: { animationId: 'anim.system.none.charge', look: a },
    b: {
      animationId: 'anim.system.none.charge',
      look: { ...defaultLook(), outfit: 'outfit.rouge' },
    },
  },
  hype: 0.4,
});

const HYPE_T2: ChoicePreview = { move: { style: 'hype', tier: 2 }, amplifier: null };

describe('withChoicePreview', () => {
  it('fait prendre a mon personnage la pose du mouvement selectionne', () => {
    const shown = withChoicePreview(scene(), 'choice', HYPE_T2, []);
    expect(shown.fighters.a.animationId).toBe(defaultAnimationFor({ style: 'hype', tier: 2 }));
  });

  it('joue la danse que j ai equipee pour ce mouvement', () => {
    const look: Look = { ...defaultLook(), dances: { 'hype.t2': FLOSS } };
    const shown = withChoicePreview(scene(look), 'choice', HYPE_T2, []);
    expect(shown.fighters.a.animationId).toBe(FLOSS);
  });

  it('pose l aura de l amplificateur touche', () => {
    const shown = withChoicePreview(scene(), 'choice', { move: null, amplifier: 2 }, []);
    expect(shown.fighters.a.auraEffectId).toBe('fx.lightning');
    // Sans mouvement choisi, la garde reste.
    expect(shown.fighters.a.animationId).toBe('anim.system.none.charge');
  });

  it('allume l aura de mon personnage, et seulement la sienne', () => {
    const shown = withChoicePreview(scene(), 'choice', { move: null, amplifier: 0 }, []);
    expect(shown.fighters.a.auraPreview).toBe(true);
    expect(shown.fighters.b.auraPreview).toBeUndefined();
  });

  it('montre le skin possede au niveau qu il habille', () => {
    const shown = withChoicePreview(scene(), 'choice', { move: null, amplifier: 2 }, ['fx.shock']);
    expect(shown.fighters.a.auraEffectId).toBe('fx.shock');
  });

  it('ne touche jamais au rig de l adversaire', () => {
    const before = scene();
    const shown = withChoicePreview(before, 'choice', { ...HYPE_T2, amplifier: 4 }, ['fx.dark']);
    expect(shown.fighters.b).toBe(before.fighters.b);
  });

  /*
    Hors de la phase de choix, l apercu n a plus rien a dire : a la revelation
    c est le serveur qui parle, et pendant la recharge suivante l ancien choix
    ne doit pas ressurgir.
  */
  it('ne s applique qu a la phase de choix', () => {
    for (const phase of ['intro', 'recharge', 'reveal', 'ended', 'idle']) {
      const before = scene();
      expect(withChoicePreview(before, phase, { ...HYPE_T2, amplifier: 3 }, [])).toBe(before);
    }
  });

  it('ne change rien sans apercu', () => {
    const before = scene();
    expect(withChoicePreview(before, 'choice', null, [])).toBe(before);
  });
});
