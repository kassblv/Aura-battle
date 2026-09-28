import { describe, expect, it } from 'vitest';
import { handFor } from './hand.js';
import { cardGesture, familyToShow } from './choiceGesture.js';
import { defaultLook, type Wardrobe } from './wardrobe.js';

/** Méditation (offerte) et Moonwalk (possede) en Calme palier 3. */
const wardrobe: Wardrobe = { look: defaultLook(), owned: new Set(['anim.calme.t3.moonwalk']) };
const cards = handFor({ family: 'calme', wardrobe, budget: 8, amplifierCost: 0, shiny: null });
const t3 = cards[3]!;

describe('cardGesture', () => {
  it('choisit une carte qui ne l est pas encore', () => {
    expect(cardGesture(t3, { style: null, tier: 0, family: 'calme' }, wardrobe)).toEqual({
      kind: 'pick',
      move: { style: 'calme', tier: 3 },
    });
  });

  /*
    Review Focus n°4 : retoucher la carte choisie la retourne sur la variante
    suivante, SANS la rechoisir — donc sans rearmer la jauge.
  */
  it('retourne la carte deja choisie sur sa variante suivante, sans la rechoisir', () => {
    const gesture = cardGesture(t3, { style: 'calme', tier: 3, family: 'calme' }, wardrobe);
    expect(gesture).toEqual({ kind: 'flip', poseId: 'anim.calme.t3.moonwalk' });
  });

  it('rechoisit une carte seule dans sa case, sans rien retourner', () => {
    const t0 = cards[0]!;
    expect(cardGesture(t0, { style: 'calme', tier: 0, family: 'calme' }, wardrobe).kind).toBe(
      'pick',
    );
  });

  it('refuse une carte trop chere', () => {
    const poor = handFor({
      family: 'calme',
      wardrobe,
      budget: 1,
      amplifierCost: 0,
      shiny: null,
    })[4]!;
    expect(cardGesture(poor, { style: null, tier: 0, family: 'calme' }, wardrobe)).toEqual({
      kind: 'deny',
      tier: 4,
    });
  });

  it('choisit la carte du meme palier dans une autre famille, sans la retourner', () => {
    expect(cardGesture(t3, { style: 'hype', tier: 3, family: 'calme' }, wardrobe).kind).toBe(
      'pick',
    );
  });
});

describe('familyToShow', () => {
  // Review Focus / relecture : au verrouillage, la main revient sur la carte jouee.
  it('revient sur la famille choisie au verrouillage', () => {
    expect(familyToShow({ locked: true, style: 'hype', family: 'calme' })).toBe('hype');
  });

  it('laisse le joueur regarder une autre famille tant qu il n a pas verrouille', () => {
    expect(familyToShow({ locked: false, style: 'hype', family: 'calme' })).toBe('calme');
    expect(familyToShow({ locked: true, style: null, family: 'calme' })).toBe('calme');
  });
});
