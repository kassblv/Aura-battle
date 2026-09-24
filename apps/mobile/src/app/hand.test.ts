import { defaultAnimationFor } from '@aura/content';
import { BALANCE } from '@aura/rules';
import { describe, expect, it } from 'vitest';
import { handFor, nextVariant, tabsFor, type HandInput } from './hand.js';
import { defaultLook, type Wardrobe } from './wardrobe.js';

const bare: Wardrobe = { look: defaultLook(), owned: new Set() };

const input = (over: Partial<HandInput> = {}): HandInput => ({
  family: 'calme',
  wardrobe: bare,
  budget: BALANCE.maxRoundCost,
  amplifierCost: 0,
  shiny: null,
  ...over,
});

describe('handFor', () => {
  it('donne cinq cartes, une par palier, dans l ordre', () => {
    const hand = handFor(input());
    expect(hand.map((card) => card.tier)).toEqual([0, 1, 2, 3, 4]);
  });

  it('montre la pose offerte quand rien n est presélectionne', () => {
    const hand = handFor(input({ family: 'acrobatie' }));
    expect(hand[2]?.poseId).toBe('anim.acrobatie.t2.wheel');
    expect(hand[2]?.name).toBe('Roue');
    expect(hand[2]?.icon).toBe('🤸');
  });

  it('montre la variante presélectionnee quand elle est possedee', () => {
    const wardrobe: Wardrobe = {
      look: { ...defaultLook(), dances: { 'calme.t3': 'anim.calme.t3.moonwalk' } },
      owned: new Set(['anim.calme.t3.moonwalk']),
    };
    const card = handFor(input({ wardrobe }))[3]!;
    expect(card.poseId).toBe('anim.calme.t3.moonwalk');
    expect(card.icon).toBe('🌙');
    // Meditation (offerte) + Moonwalk (possede) ; Coup de pied lent a debloquer.
    expect(card.variants).toEqual({ index: 1, owned: 2, toUnlock: 1 });
  });

  it('donne la puissance et le cout du palier, depuis le moteur', () => {
    const card = handFor(input())[4]!;
    expect(card.power).toBe(BALANCE.tierPower[4]);
    expect(card.cost).toBe(BALANCE.tierCost[4]);
  });

  it('grise une carte que l energie ne couvre pas, amplificateur compris', () => {
    const hand = handFor(input({ budget: 3, amplifierCost: 1 }));
    expect(hand.map((card) => card.affordable)).toEqual([true, true, true, false, false]);
  });

  it('fait briller la seule carte de la case tiree', () => {
    const hand = handFor(input({ family: 'hype', shiny: { style: 'hype', tier: 1 } }));
    expect(hand.map((card) => card.shiny)).toEqual([false, true, false, false, false]);
    expect(
      handFor(input({ family: 'calme', shiny: { style: 'hype', tier: 1 } })).some((c) => c.shiny),
    ).toBe(false);
  });

  // Review Focus n°1 : une brillante trop chere brille, mais reste grisee.
  it('garde grisee une brillante trop chere', () => {
    const card = handFor(
      input({ family: 'prouesse', budget: 2, shiny: { style: 'prouesse', tier: 4 } }),
    )[4]!;
    expect(card.shiny).toBe(true);
    expect(card.affordable).toBe(false);
  });
});

describe('nextVariant', () => {
  it('boucle sur les poses possedees de la case', () => {
    const wardrobe: Wardrobe = { look: defaultLook(), owned: new Set(['anim.calme.t3.moonwalk']) };
    const move = { style: 'calme', tier: 3 } as const;
    expect(nextVariant(wardrobe, move)).toBe('anim.calme.t3.moonwalk');
    const after: Wardrobe = {
      ...wardrobe,
      look: { ...defaultLook(), dances: { 'calme.t3': 'anim.calme.t3.moonwalk' } },
    };
    expect(nextVariant(after, move)).toBe(defaultAnimationFor(move));
  });
});

describe('tabsFor', () => {
  it('donne les cinq familles avec ce que chacune bat', () => {
    const tabs = tabsFor(null);
    expect(tabs.map((tab) => tab.family)).toEqual(BALANCE.styles);
    expect(tabs[3]).toMatchObject({ family: 'acrobatie', icon: '🤸', beats: ['prouesse', 'hype'] });
  });

  // Review Focus n°2 : la brillante attend dans une autre famille.
  it('signale l onglet ou attend la brillante', () => {
    const tabs = tabsFor({ style: 'provoc', tier: 2 });
    expect(tabs.filter((tab) => tab.shiny).map((tab) => tab.family)).toEqual(['provoc']);
  });
});
