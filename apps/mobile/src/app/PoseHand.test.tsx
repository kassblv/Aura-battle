import { BALANCE } from '@aura/rules';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { handFor, tabsFor } from './hand.js';
import { PoseHand } from './PoseHand.js';
import { defaultLook } from './wardrobe.js';

const render = (budget = BALANCE.maxRoundCost): string =>
  renderToStaticMarkup(
    createElement(PoseHand, {
      tabs: tabsFor({ style: 'acrobatie', tier: 1 }),
      family: 'acrobatie',
      cards: handFor({
        family: 'acrobatie',
        wardrobe: { look: defaultLook(), owned: new Set() },
        budget,
        amplifierCost: 0,
        shiny: { style: 'acrobatie', tier: 1 },
      }),
      selectedTier: 2,
      locked: false,
      chosenFamily: 'acrobatie',
      dealing: true,
      denyTick: 0,
      deniedTier: null,
      onTab: () => undefined,
      onCard: () => undefined,
    }),
  );

const count = (html: string, pattern: RegExp): number => html.match(pattern)?.length ?? 0;

describe('PoseHand', () => {
  it('rend cinq onglets et cinq cartes, tous des boutons', () => {
    const html = render();
    expect(count(html, /<button[^>]*class="hand__tab"/g)).toBe(5);
    expect(count(html, /<button[^>]*class="hand__card"/g)).toBe(5);
  });

  it('fait briller la carte et l onglet de la case brillante', () => {
    const html = render();
    expect(count(html, /class="hand__card"[^>]*data-shiny="true"/g)).toBe(1);
    expect(count(html, /class="hand__tab"[^>]*data-shiny="true"/g)).toBe(1);
    expect(html).toContain('hand__sheen');
  });

  it('souleve la carte choisie, et son onglet le rappelle', () => {
    const html = render();
    expect(count(html, /data-selected="true"/g)).toBe(1);
    expect(count(html, /class="hand__tab"[^>]*data-chosen="true"/g)).toBe(1);
  });

  // Des boutons a bascule, pas un faux motif d'onglets sans panneau.
  it('annonce les familles comme des boutons a bascule', () => {
    const html = render();
    expect(html).not.toContain('role="tab"');
    expect(count(html, /class="hand__tab"[^>]*aria-pressed="true"/g)).toBe(1);
  });

  // Une carte trop chere reste un bouton ACTIF : on la touche pour savoir ce qui manque.
  it('grise une carte trop chere sans la desactiver', () => {
    const html = render(1);
    const poor = html.match(/<button[^>]*data-poor="true"[^>]*>/g) ?? [];
    expect(poor.length).toBe(3);
    for (const tag of poor) expect(tag).not.toContain('disabled');
  });

  it('montre le pictogramme et le nom de chaque pose', () => {
    const html = render();
    for (const text of ['🙌', '🌀', '🤸', '🌪️', '🔄', 'Roulade', 'Salto arrière']) {
      expect(html).toContain(text);
    }
  });
});
