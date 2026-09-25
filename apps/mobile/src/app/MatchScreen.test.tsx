import { BALANCE } from '@aura/rules';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { matchRules } from '../match/rules.js';
import type { MatchView } from '../match/view.js';
import { MatchScreen } from './MatchScreen.js';

/*
  Evenements de la semaine (chantier n°7) : pendant un match a variante, aucun
  nombre de regle a l'ecran ne vient du `BALANCE` statique.
*/

const view = (variant: string | null, over: Partial<MatchView> = {}): MatchView => ({
  ...matchRules(variant),
  phase: 'choice',
  round: 2,
  phaseEndsAtMs: 15_000,
  phaseDurationMs: 15_000,
  me: { energy: 8, ultimate: 60, roundsWon: 0, shiny: null },
  opponent: { energy: null, ultimate: null, roundsWon: 0, shiny: null },
  orbs: [],
  taps: [],
  meterPeriodMs: 1_700,
  opponentLocked: false,
  lastRound: null,
  ended: null,
  ...over,
});

const render = (matchView: MatchView): string =>
  renderToStaticMarkup(
    createElement(MatchScreen, {
      view: matchView,
      actions: { tap: () => undefined, lock: () => false },
      nowMs: 0,
      clock: () => 0,
      opponentName: 'Nova',
      onLeave: () => undefined,
      onRematch: () => undefined,
      rematchLabel: 'Rejouer',
    }),
  );

const ultimateButton = (html: string): string =>
  /<button[^>]*class="ultimate"[^>]*>/.exec(html)?.[0] ?? '';

describe('MatchScreen : les regles du match', () => {
  it('Ultime express : la jauge est pleine a 60', () => {
    const html = render(view('ultime'));
    expect(html).toContain('aria-label="Ultime prêt"');
    expect(ultimateButton(html)).not.toContain('disabled');
  });

  it('regles normales : 60 n est que 60 %', () => {
    const html = render(view(null));
    expect(html).toContain('Ultime à 60 %');
    expect(ultimateButton(html)).toContain('disabled');
  });

  it('dessine autant de points d energie que le match en donne', () => {
    const html = render(view(null));
    const energy = /<span class="energy"[^>]*>(.*?)<\/span>/.exec(html)?.[1] ?? '';
    expect(energy.match(/<i/g)?.length).toBe(BALANCE.match.startingEnergy);
  });

  it('nomme l evenement dans le HUD, et rien en regles normales', () => {
    expect(render(view('contres'))).toContain('⚡ Contres tranchants');
    expect(render(view(null))).not.toContain('hud__event');
  });

  it('annonce l evenement a l intro de la premiere manche seulement', () => {
    const intro = render(view('brillance', { phase: 'intro', round: 1 }));
    expect(intro).toContain('<h2>⚡ Semaine brillante</h2>');
    expect(intro).toContain('×1,5 au lieu de ×1,2');
    expect(render(view('brillance', { phase: 'intro', round: 2 }))).not.toContain('<h2>⚡');
  });
});
