import { BALANCE } from '@aura/rules';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { handFor, tabsFor } from './hand.js';
import { IntentBubbles, IntentPickerView } from './IntentBubble.js';
import { PoseHand } from './PoseHand.js';
import { defaultLook } from './wardrobe.js';

/*
  La bulle d'intention (2.6.0, test A/B) : le geste d'annonce dans la main de
  cartes, et les bulles au-dessus des combattants.
*/

const count = (html: string, pattern: RegExp): number => html.match(pattern)?.length ?? 0;

const picker = (open: boolean): string =>
  renderToStaticMarkup(
    createElement(IntentPickerView, {
      open,
      tabs: tabsFor(null),
      bonus: BALANCE.intent.ultimateBonus,
      onToggle: () => undefined,
      onPick: () => undefined,
    }),
  );

describe('IntentPickerView', () => {
  it('ferme : un seul bouton « Annoncer », rien d autre a toucher', () => {
    const html = picker(false);
    expect(count(html, /<button[^>]*class="intent__toggle"/g)).toBe(1);
    expect(html).toContain('Annoncer');
    expect(html).toContain('aria-expanded="false"');
    expect(html).not.toContain('intent__pick');
  });

  it('ouvert : les cinq familles, chacune un bouton nomme', () => {
    const html = picker(true);
    expect(count(html, /<button[^>]*class="intent__pick"/g)).toBe(5);
    expect(html).toContain('aria-expanded="true"');
    expect(html).toContain('aria-label="Annoncer Calme"');
    for (const tab of tabsFor(null)) expect(html).toContain(tab.icon);
  });

  it('ouvert : dit ce que rapporte une bulle tenue, pour donner envie de bluffer', () => {
    const html = picker(true);
    expect(html).toContain('bluff');
    expect(html).toContain(`+${String(BALANCE.intent.ultimateBonus)}`);
  });
});

const bubbles = (mine: 'calme' | null, theirs: 'hype' | null): string =>
  renderToStaticMarkup(createElement(IntentBubbles, { mine, theirs, opponentName: 'Nova' }));

describe('IntentBubbles', () => {
  it('rien tant que personne n a annonce', () => {
    expect(bubbles(null, null)).toBe('');
  });

  it('la bulle adverse, au-dessus de l adversaire, avec le pictogramme de sa famille', () => {
    const html = bubbles(null, 'hype');
    expect(count(html, /class="intent-bubble"/g)).toBe(1);
    expect(html).toContain('data-side="adversaire"');
    expect(html).toContain('Nova annonce Hype');
    expect(html).toContain(tabsFor(null).find((t) => t.family === 'hype')!.icon);
  });

  it('la mienne au-dessus de moi, a cote de la sienne', () => {
    const html = bubbles('calme', 'hype');
    expect(count(html, /class="intent-bubble"/g)).toBe(2);
    expect(html).toContain('data-side="moi"');
    expect(html).toContain('Tu annonces Calme');
  });
});

const hand = (canAnnounce: boolean): string =>
  renderToStaticMarkup(
    createElement(PoseHand, {
      tabs: tabsFor(null),
      family: 'calme',
      cards: handFor({
        family: 'calme',
        wardrobe: { look: defaultLook(), owned: new Set() },
        budget: BALANCE.maxRoundCost,
        amplifierCost: 0,
        shiny: null,
      }),
      selectedTier: null,
      locked: false,
      chosenFamily: null,
      dealing: true,
      denyTick: 0,
      deniedTier: null,
      onTab: () => undefined,
      onCard: () => undefined,
      canAnnounce,
      intentBonus: BALANCE.intent.ultimateBonus,
      onAnnounce: () => undefined,
    }),
  );

describe('PoseHand et la bulle', () => {
  it('porte le geste d annonce quand il a un sens', () => {
    expect(count(hand(true), /class="intent__toggle"/g)).toBe(1);
  });

  it('sans bulle, ou une fois annonce ou verrouille : aucun geste', () => {
    expect(hand(false)).not.toContain('intent__');
  });
});
