import { describe, expect, it } from 'vitest';
import { VERDICT_PANEL_AT_MS } from '../arena/round.js';
import { revealScene } from '../app/reveal.js';
import { defaultLook } from '../app/wardrobe.js';
import type { RoundView } from '../match/view.js';
import { DARK, TYPOGRAPHY } from '../ui/theme.js';
import { clipTheme, drawClipFrame, type ClipContext } from './composer.js';
import { clipLayout } from './layout.js';

const view: RoundView = {
  round: 1,
  winner: 'moi',
  myScore: 50,
  opponentScore: 30,
  myQuality: 'good',
  myUltimate: false,
  countered: true,
  myShiny: false,
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
};

/** Un contexte 2D qui retient ce qu on lui fait peindre. */
function recordingContext(): { ctx: ClipContext; texts: string[]; images: unknown[][] } {
  const texts: string[] = [];
  const images: unknown[][] = [];
  const noop = (): void => undefined;
  const ctx = {
    save: noop,
    restore: noop,
    translate: noop,
    scale: noop,
    beginPath: noop,
    moveTo: noop,
    arcTo: noop,
    closePath: noop,
    fill: noop,
    stroke: noop,
    fillRect: noop,
    fillText: (text: string) => {
      texts.push(text);
    },
    measureText: (text: string) => ({ width: text.length * 10 }),
    drawImage: (...args: unknown[]) => {
      images.push(args);
    },
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 1,
    font: '',
    textAlign: 'left',
    textBaseline: 'alphabetic',
    globalAlpha: 1,
  } as unknown as ClipContext;
  return { ctx, texts, images };
}

describe('clipTheme', () => {
  it('lit les couleurs de la feuille de style', () => {
    const theme = clipTheme((name) => (name === '--accent' ? ' #123456 ' : '#abcdef'));
    expect(theme.accent).toBe('#123456');
    expect(theme.bg).toBe('#abcdef');
  });

  it('se rabat sur la palette sombre quand une variable manque', () => {
    const theme = clipTheme(() => '');
    expect(theme).toMatchObject({
      bg: DARK.bg,
      ink: DARK.ink,
      gold: DARK.goldInk,
      display: TYPOGRAPHY.display,
    });
  });
});

describe('drawClipFrame', () => {
  it('copie l arene entiere dans sa bande et ecrit le verdict et l appel', () => {
    const layout = clipLayout({
      scene: revealScene(view, { look: defaultLook(), owned: new Set() }),
      outcome: { winner: 'moi', myScore: 50, opponentScore: 30 },
      arena: { width: 1688, height: 780 },
      elapsedMs: VERDICT_PANEL_AT_MS + 500,
    });
    const { ctx, texts, images } = recordingContext();
    const source = { width: 1688, height: 780 } as unknown as HTMLCanvasElement;

    drawClipFrame(
      ctx,
      source,
      layout,
      clipTheme(() => ''),
    );

    expect(images).toEqual([
      [source, 0, 0, 1688, 780, layout.arena.x, layout.arena.y, layout.arena.w, layout.arena.h],
    ]);
    expect(texts).toEqual(
      expect.arrayContaining([
        'Roue',
        'Pompes',
        '🤸 BAT 💪 · ×1,35',
        'Manche gagnée',
        '50 – 30',
        'Défie-moi sur',
        'Aura Battle',
      ]),
    );
  });

  it('ne copie pas un canvas vide', () => {
    const layout = clipLayout({
      scene: revealScene(view, { look: defaultLook(), owned: new Set() }),
      outcome: { winner: 'moi', myScore: 50, opponentScore: 30 },
      arena: { width: 0, height: 0 },
      elapsedMs: 0,
    });
    const { ctx, images } = recordingContext();
    drawClipFrame(
      ctx,
      { width: 0, height: 0 } as unknown as HTMLCanvasElement,
      layout,
      clipTheme(() => ''),
    );
    expect(images).toEqual([]);
  });
});
