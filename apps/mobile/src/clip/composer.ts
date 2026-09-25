import { DARK, TYPOGRAPHY } from '../ui/theme.js';
import { CLIP_HEIGHT, CLIP_WIDTH, type ClipCard, type ClipLayout, type Rect } from './layout.js';

/**
 * Le compositeur du clip : peint UNE image, a partir de l arene et de la mise
 * en page du moment.
 *
 * Il ne decide rien — `layout.ts` a deja dit quoi montrer et ou. Il est appele
 * dans la boucle de l arene, juste apres son rendu (ADR 0017) : c est le seul
 * instant ou le canvas WebGL se copie sans rendre du noir.
 *
 * Les couleurs sont celles de la feuille de style, lues une fois sur `:root` :
 * le clip porte l identite du jeu sans en recopier la palette. Les replis sont
 * la palette sombre de `ui/theme.ts`, celle que `styles.css` recopie.
 */

export interface ClipTheme {
  readonly bg: string;
  readonly surface: string;
  readonly chip: string;
  readonly line: string;
  readonly ink: string;
  readonly muted: string;
  readonly accent: string;
  readonly gold: string;
  readonly good: string;
  readonly bad: string;
  readonly display: string;
  readonly body: string;
}

/** Variable CSS lue pour chaque couleur du clip, et son repli. */
const SOURCES: Readonly<Record<keyof ClipTheme, readonly [string, string]>> = {
  bg: ['--bg', DARK.bg],
  surface: ['--surface', DARK.surface],
  chip: ['--chip', DARK.chip],
  line: ['--line', DARK.line],
  ink: ['--ink', DARK.ink],
  muted: ['--muted', DARK.muted],
  accent: ['--accent', DARK.accent],
  gold: ['--gold-ink', DARK.goldInk],
  good: ['--good-ink', DARK.goodInk],
  bad: ['--bad-ink', DARK.badInk],
  display: ['--display', TYPOGRAPHY.display],
  body: ['--body', TYPOGRAPHY.body],
};

/** Le theme du clip, lu par `read` (une variable CSS -> sa valeur, ou vide). */
export function clipTheme(read: (name: string) => string): ClipTheme {
  const theme = {} as Record<keyof ClipTheme, string>;
  for (const key of Object.keys(SOURCES) as (keyof ClipTheme)[]) {
    const [name, fallback] = SOURCES[key];
    const value = read(name).trim();
    theme[key] = value === '' ? fallback : value;
  }
  return theme;
}

/** Le theme de la page, lu une fois. Hors navigateur, les replis. */
export function readClipTheme(): ClipTheme {
  if (typeof document === 'undefined' || typeof getComputedStyle === 'undefined') {
    return clipTheme(() => '');
  }
  const style = getComputedStyle(document.documentElement);
  return clipTheme((name) => style.getPropertyValue(name));
}

/** Le sous-ensemble du contexte 2D qu on utilise : ce qui se simule en test. */
export type ClipContext = Pick<
  CanvasRenderingContext2D,
  | 'save'
  | 'restore'
  | 'translate'
  | 'scale'
  | 'beginPath'
  | 'moveTo'
  | 'arcTo'
  | 'closePath'
  | 'fill'
  | 'stroke'
  | 'fillRect'
  | 'fillText'
  | 'measureText'
  | 'drawImage'
  | 'fillStyle'
  | 'strokeStyle'
  | 'lineWidth'
  | 'font'
  | 'textAlign'
  | 'textBaseline'
  | 'globalAlpha'
>;

/** Ce que l arene donne : un canvas, dont on copie tout le tampon. */
export interface ClipSource {
  readonly width: number;
  readonly height: number;
}

function roundRect(ctx: ClipContext, rect: Rect, radius: number): void {
  const { x, y, w, h } = rect;
  const r = Math.min(radius, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/** Ecrit une ligne, en reduisant la police jusqu a ce qu elle tienne. */
function fitText(
  ctx: ClipContext,
  text: string,
  x: number,
  y: number,
  maxWidth: number,
  size: number,
  family: string,
  weight = '400',
): void {
  let px = size;
  ctx.font = `${weight} ${String(px)}px ${family}`;
  while (px > 12 && ctx.measureText(text).width > maxWidth) {
    px -= 2;
    ctx.font = `${weight} ${String(px)}px ${family}`;
  }
  ctx.fillText(text, x, y);
}

/** Pose une transformation d echelle autour du centre de `rect`. */
function around(ctx: ClipContext, rect: Rect, sx: number, sy: number): void {
  const cx = rect.x + rect.w / 2;
  const cy = rect.y + rect.h / 2;
  ctx.translate(cx, cy);
  ctx.scale(sx, sy);
  ctx.translate(-cx, -cy);
}

function drawCard(ctx: ClipContext, card: ClipCard, theme: ClipTheme): void {
  const { rect } = card;
  const cx = rect.x + rect.w / 2;

  // L etiquette ne tourne pas avec la carte : elle dit a qui elle est.
  ctx.fillStyle = theme.muted;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  fitText(ctx, card.label.toUpperCase(), cx, rect.y - 14, rect.w, 24, theme.body, '700');

  if (card.face === 'hidden' || card.scale <= 0 || card.scaleX <= 0.001) return;

  ctx.save();
  around(ctx, rect, card.scale * card.scaleX, card.scale);
  roundRect(ctx, rect, 24);
  ctx.fillStyle = card.face === 'back' ? theme.chip : theme.surface;
  ctx.fill();
  ctx.lineWidth = card.badge !== null && card.face === 'front' ? 6 : 3;
  ctx.strokeStyle = card.badge !== null && card.face === 'front' ? theme.gold : theme.line;
  ctx.stroke();

  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  if (card.face === 'back') {
    ctx.fillStyle = theme.muted;
    ctx.font = `400 140px ${theme.display}`;
    ctx.fillText('?', cx, rect.y + rect.h / 2);
  } else {
    const inner = rect.w - 32;
    ctx.fillStyle = theme.muted;
    fitText(ctx, card.tier.toUpperCase(), cx, rect.y + 32, inner, 22, theme.body, '700');
    ctx.fillStyle = theme.ink;
    ctx.font = `400 104px ${theme.body}`;
    ctx.fillText(card.icon, cx, rect.y + 122);
    fitText(ctx, card.name, cx, rect.y + 206, inner, 34, theme.body, '800');
    ctx.fillStyle = theme.muted;
    fitText(ctx, card.family, cx, rect.y + 252, inner, 24, theme.body, '600');
  }
  ctx.restore();

  /*
    Le badge de la brillante : une pastille doree a cheval sur le bas de la
    carte, texte sombre — comme dans le jeu. En texte dore nu, il se perdait
    dans le cadre dore de la carte.
  */
  if (card.badge !== null && card.face === 'front') {
    ctx.font = `400 26px ${theme.display}`;
    const w = Math.min(rect.w, ctx.measureText(card.badge).width + 32);
    const pill = { x: cx - w / 2, y: rect.y + rect.h - 20, w, h: 40 };
    roundRect(ctx, pill, 20);
    ctx.fillStyle = theme.gold;
    ctx.fill();
    ctx.fillStyle = theme.bg;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    fitText(ctx, card.badge, cx, pill.y + pill.h / 2 + 1, w - 16, 26, theme.display);
  }
}

export function drawClipFrame(
  ctx: ClipContext,
  source: CanvasImageSource & ClipSource,
  layout: ClipLayout,
  theme: ClipTheme,
): void {
  ctx.globalAlpha = 1;
  ctx.fillStyle = theme.bg;
  ctx.fillRect(0, 0, CLIP_WIDTH, CLIP_HEIGHT);

  // L arene entiere, jamais recadree : les deux combattants restent a l image.
  const { band, arena } = layout;
  ctx.fillStyle = theme.surface;
  ctx.fillRect(band.x, band.y, band.w, band.h);
  if (source.width > 0 && source.height > 0) {
    ctx.drawImage(source, 0, 0, source.width, source.height, arena.x, arena.y, arena.w, arena.h);
  }

  for (const card of layout.cards) drawCard(ctx, card, theme);

  const { callout } = layout;
  if (callout !== null) {
    const { rect } = callout;
    ctx.save();
    around(ctx, rect, callout.scale, callout.scale);
    roundRect(ctx, rect, 28);
    ctx.fillStyle = theme.surface;
    ctx.fill();
    ctx.lineWidth = 3;
    ctx.strokeStyle = callout.good ? theme.gold : theme.bad;
    ctx.stroke();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const cx = rect.x + rect.w / 2;
    ctx.fillStyle = theme.muted;
    fitText(ctx, callout.who, cx, rect.y + 30, rect.w - 40, 26, theme.body, '700');
    ctx.fillStyle = callout.good ? theme.gold : theme.bad;
    fitText(ctx, callout.line, cx, rect.y + 76, rect.w - 40, 50, theme.display);
    ctx.restore();
  }

  const { verdict } = layout;
  if (verdict !== null) {
    const { rect } = verdict;
    const cx = rect.x + rect.w / 2;
    ctx.save();
    around(ctx, rect, verdict.scale, verdict.scale);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = verdict.won ? theme.good : theme.bad;
    fitText(ctx, verdict.title, cx, rect.y + 52, rect.w, 64, theme.display);
    ctx.fillStyle = theme.ink;
    fitText(ctx, verdict.score, cx, rect.y + 118, rect.w, 40, theme.display);
    ctx.restore();
  }

  const { cta } = layout;
  const cx = cta.rect.x + cta.rect.w / 2;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = theme.ink;
  fitText(ctx, cta.text, cx, cta.rect.y + 30, cta.rect.w, 32, theme.body, '700');
  ctx.fillStyle = theme.accent;
  fitText(ctx, cta.brand, cx, cta.rect.y + 88, cta.rect.w, 72, theme.display);
}
