import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { variantConfig } from '@aura/rules';
import { revealScene, type RevealScene } from './reveal.js';
import { defaultLook } from './wardrobe.js';
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
    shinyMultiplier: 1.2,
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
    shinyMultiplier: 1.2,
  },
  callout: { kind: 'counter', by: 'moi', winner: 'acrobatie', loser: 'prouesse', multiplier: 1.35 },
  calloutAtMs: 1550,
  kept: null,
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

  it('pose le badge de la bulle tenue, a part du bandeau du contre', () => {
    const html = render(scene({ kept: { bonus: 10, atMs: 2000 } }));
    expect(count(html, /class="reveal__kept"/g)).toBe(1);
    expect(html).toContain('Bulle tenue');
    expect(html).toContain('+10');
    // Deux elements distincts : le badge ne vit pas dans le bandeau.
    expect(html).toMatch(/reveal__callout[\s\S]*<\/div>[\s\S]*reveal__kept/);
  });

  it('pas de badge sans bulle tenue', () => {
    expect(render(scene())).not.toContain('reveal__kept');
  });

  it('se tait sans bandeau', () => {
    expect(render(scene({ callout: null }))).not.toContain('reveal__callout');
  });

  /*
    Evenements de la semaine : les nombres du bandeau et du badge viennent des
    regles du MATCH. Scene construite par `revealScene`, comme a l'ecran.
  */
  const played = (variant: string): string =>
    render(
      revealScene(
        {
          round: 1,
          winner: 'moi',
          myScore: 50,
          opponentScore: 30,
          myQuality: 'good',
          myUltimate: false,
          countered: true,
          myShiny: true,
          opponentShiny: false,
          myMove: { style: 'acrobatie', tier: 2 },
          opponentMove: { style: 'prouesse', tier: 1 },
          myPoseId: null,
          opponentPoseId: null,
          counteredBy: 'moi',
          counterBlocked: false,
          revealFirst: 'adversaire',
          opponentQuality: 'good',
          opponentUltimate: false,
          myIntentKept: false,
        },
        { look: defaultLook(), owned: new Set() },
        variantConfig(variant),
      ),
    );

  it('ecrit ×1,6 au contre pendant Contres tranchants', () => {
    const html = played('contres');
    expect(html).toContain('×1,6');
    expect(html).not.toContain('×1,35');
  });

  it('ecrit ✨ ×1,5 a la brillante pendant la Semaine brillante', () => {
    const html = played('brillance');
    expect(html).toContain('✨ ×1,5');
    expect(html).not.toContain('×1,2');
  });
});
