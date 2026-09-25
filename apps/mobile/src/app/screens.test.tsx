import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { MatchEvent } from '../match/rules.js';
import { homeClusters } from '../ui/layout.js';
import { memeGallery } from './memes.js';
import { newProfile } from './profile.js';
import { HomeScreen } from './screens.js';

/* L'evenement de la semaine a l'accueil (chantier n°7). */

const EVENT: MatchEvent = {
  id: 'brillance',
  name: 'Semaine brillante',
  pitch: 'La carte brillante vaut ×1,5 au lieu de ×1,2.',
};

const noop = (): void => undefined;

const render = (mode: 'ranked' | 'casual', weekEvent: MatchEvent | null): string =>
  renderToStaticMarkup(
    createElement(HomeScreen, {
      profile: newProfile('Kai', 'p_1'),
      mode,
      weekEvent,
      onToggleMode: noop,
      meme: memeGallery()[0]!,
      onStepMeme: noop,
      memeOwned: true,
      memeEquipped: false,
      onEquipMeme: noop,
      onPlay: noop,
      onProfile: noop,
      onSettings: noop,
      onLeaderboard: noop,
      clusters: homeClusters(844),
      questsReady: 0,
      onChallenges: noop,
      seasonReady: 0,
      onSeason: noop,
      onWardrobe: noop,
      onShop: noop,
      onOnline: noop,
      onInvite: noop,
    }),
  );

describe('HomeScreen : l evenement de la semaine', () => {
  it('l annonce en partie rapide, dans la grappe de lancement', () => {
    const html = render('casual', EVENT);
    expect(html).toMatch(/class="launch"[^>]*>\s*<p class="launch__event">/);
    expect(html).toContain('⚡ Cette semaine : Semaine brillante');
    expect(html).toContain(EVENT.pitch);
    expect(html).toContain('class="launch__badge"');
  });

  it('se tait en classe, qui joue les regles normales', () => {
    const html = render('ranked', EVENT);
    expect(html).not.toContain('launch__event');
    expect(html).not.toContain('launch__badge');
  });

  it('se tait une semaine normale', () => {
    const html = render('casual', null);
    expect(html).not.toContain('launch__event');
    expect(html).not.toContain('launch__badge');
  });
});
