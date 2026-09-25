import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { RevealScene } from './reveal.js';
import { RevealStage } from './RevealStage.js';

const scene = (over: Partial<RevealScene> = {}): RevealScene => ({
  mine: {
    poseId: 'anim.acrobatie.t2.wheel',
    name: 'Roue',
    icon: '🤸',
    family: 'acrobatie',
    tier: 2,
    atMs: 820,
    faceDown: false,
    shiny: true,
  },
  theirs: {
    poseId: 'anim.prouesse.t1.pushups',
    name: 'Pompes',
    icon: '🏋️',
    family: 'prouesse',
    tier: 1,
    atMs: 120,
    faceDown: true,
    shiny: false,
  },
  callout: { kind: 'counter', by: 'moi', winner: 'acrobatie', loser: 'prouesse', multiplier: 1.35 },
  calloutAtMs: 1550,
  ...over,
});

const render = (s: RevealScene, elapsedMs = 0): string =>
  renderToStaticMarkup(createElement(RevealStage, { scene: s, elapsedMs, opponentName: 'Zed' }));

const count = (html: string, pattern: RegExp): number => html.match(pattern)?.length ?? 0;

describe('RevealStage', () => {
  it('pose deux cartes, dont l adverse face cachee qui se retourne', () => {
    const html = render(scene());
    expect(count(html, /class="reveal__card"/g)).toBe(2);
    expect(count(html, /data-face-down="true"/g)).toBe(1);
    expect(html).toContain('reveal__back');
    expect(html).toContain('Roue');
    expect(html).toContain('Pompes');
  });

  it('cale chaque carte sur son instant, moins le temps deja ecoule', () => {
    const html = render(scene(), 500);
    expect(html).toContain('--at:320ms');
    expect(html).toContain('--at:-380ms');
    expect(html).toContain('--at:1050ms');
  });

  it('ecrit le contre du point de vue de la famille qui gagne', () => {
    const html = render(scene());
    expect(html).toMatch(/🤸[^<]*<\/span>\s*<b[^>]*>BAT<\/b>\s*<span[^>]*>💪/u);
    expect(html).toContain('×1,35');
    expect(html).toContain('data-by="moi"');
  });

  it('annonce un miroir', () => {
    const html = render(scene({ callout: { kind: 'mirror', family: 'hype' } }));
    expect(html).toContain('MIROIR');
  });

  it('annonce un contre bloque', () => {
    const html = render(scene({ callout: { kind: 'blocked', by: 'adversaire' } }));
    expect(html).toContain('CONTRE BLOQUÉ');
    expect(html).toContain('Zed');
  });

  it('fait eclater la brillante avec son multiplicateur', () => {
    const html = render(scene());
    expect(count(html, /data-shiny="true"/g)).toBe(1);
    expect(html).toContain('✨ ×1,2');
  });

  it('se tait sans bandeau', () => {
    expect(render(scene({ callout: null }))).not.toContain('reveal__callout');
  });
});
