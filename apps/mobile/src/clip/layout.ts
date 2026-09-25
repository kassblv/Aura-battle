import { styleIcon, styleName, tierName } from '@aura/content';
import { BALANCE } from '@aura/rules';
import { VERDICT_PANEL_AT_MS } from '../arena/round.js';
import type { RevealCallout, RevealCard, RevealScene, Side } from '../app/reveal.js';

/**
 * La mise en page du clip de revelation (ADR 0017), en donnees pures.
 *
 * Un format vertical 720x1280 — celui de Shorts, Reels et TikTok — compose
 * autour d une arene qui, elle, est en paysage. La recadrer en 9:16 couperait
 * les deux combattants, places a gauche et a droite : l arene passe donc
 * ENTIERE, en bande au milieu, et le haut et le bas racontent le reste.
 *
 * - en haut : les deux cartes jouees, puis le bandeau du contre ;
 * - au milieu : l arene, a son rapport d origine, bordee de fond ;
 * - en bas : le verdict de la manche et l appel au duel.
 *
 * Chaque element arrive a l instant ou la revelation le montre a l ecran
 * (`reveal.ts`, `arena/round.ts`) : le clip raconte la meme chose, au meme
 * rythme. Tout se decide ici a partir du temps ecoule — le compositeur ne fait
 * que peindre, et la chronologie se teste sans canvas.
 *
 * Aucun nom de joueur n entre dans l image : « Moi » et « Adversaire ». Un
 * clip se publie, et le pseudo de l adversaire n est pas au joueur de le
 * publier (ADR 0017 : aucune donnee personnelle ajoutee).
 */

export const CLIP_WIDTH = 720;
export const CLIP_HEIGHT = 1280;

export interface Rect {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

/** Duree du claquement d une carte, d un bandeau ou du verdict. */
export const CLIP_POP_MS = 260;
/** Duree du retournement de la carte adverse. */
export const CLIP_FLIP_MS = 420;

export type ClipCardFace = 'hidden' | 'back' | 'front';

export interface ClipCard {
  readonly side: Side;
  readonly rect: Rect;
  readonly face: ClipCardFace;
  /** Echelle horizontale : le retournement passe par zero. */
  readonly scaleX: number;
  /** Echelle generale : le claquement depasse un peu avant de se poser. */
  readonly scale: number;
  readonly label: string;
  readonly tier: string;
  readonly icon: string;
  readonly name: string;
  readonly family: string;
  /** « ✨ ×1,2 » pour une brillante, sinon `null`. */
  readonly badge: string | null;
}

export interface ClipCallout {
  readonly rect: Rect;
  readonly kind: RevealCallout['kind'];
  /** Qui l a emporte, pour la couleur : le contre de l adversaire est une defaite. */
  readonly good: boolean;
  readonly who: string;
  readonly line: string;
  readonly scale: number;
}

export interface ClipVerdict {
  readonly rect: Rect;
  readonly title: string;
  readonly score: string;
  readonly won: boolean;
  readonly scale: number;
}

export interface ClipLayout {
  /** La bande de l arene, bordee de fond. */
  readonly band: Rect;
  /** L image de l arene dans la bande, a son rapport d origine. */
  readonly arena: Rect;
  readonly cards: readonly ClipCard[];
  readonly callout: ClipCallout | null;
  readonly verdict: ClipVerdict | null;
  readonly cta: { readonly rect: Rect; readonly text: string; readonly brand: string };
}

export interface ClipOutcome {
  readonly winner: Side | null;
  readonly myScore: number;
  readonly opponentScore: number;
}

export interface ClipLayoutInput {
  readonly scene: RevealScene;
  readonly outcome: ClipOutcome;
  /** Taille du tampon de l arene, en pixels : seul son rapport compte. */
  readonly arena: { readonly width: number; readonly height: number };
  /** Temps ecoule depuis le debut de la revelation. */
  readonly elapsedMs: number;
}

const MARGIN = 36;
const GAP = 24;
const CARD_TOP = 56;
const CARD_H = 290;
const CALLOUT_H = 116;
/**
 * La place du badge de la brillante, dessine SOUS la carte : sans elle, il
 * mordait le cadre et touchait le bandeau du contre.
 */
export const CLIP_BADGE_SPACE = 40;
/** Haut du bandeau du contre : sous les cartes et la place du badge. */
const CALLOUT_TOP = CARD_TOP + CARD_H + CLIP_BADGE_SPACE;
/** Haut de la bande de l arene : sous les cartes et le bandeau. */
const BAND_TOP = CALLOUT_TOP + CALLOUT_H + GAP;
const VERDICT_H = 150;
const CTA_H = 130;
/** Bas de la bande : au-dessus du verdict et de l appel. */
const BAND_BOTTOM = CLIP_HEIGHT - MARGIN - CTA_H - GAP - VERDICT_H - GAP;

const mult = (value: number): string => `×${String(value).replace('.', ',')}`;

const clamp01 = (value: number): number => Math.min(1, Math.max(0, value));

/** Depassement leger, comme `--e-over` : ce qui donne du poids a ce qui arrive. */
function overshoot(t: number): number {
  const c = 1.56;
  const u = t - 1;
  return 1 + (c + 1) * u * u * u + c * u * u;
}

/** Echelle d un element qui claque a `atMs`. */
function pop(elapsedMs: number, atMs: number): number {
  return overshoot(clamp01((elapsedMs - atMs) / CLIP_POP_MS));
}

/** L arene entiere, centree dans sa bande : jamais recadree (ADR 0017). */
function fit(width: number, height: number): { band: Rect; arena: Rect } {
  const band: Rect = { x: 0, y: BAND_TOP, w: CLIP_WIDTH, h: BAND_BOTTOM - BAND_TOP };
  const ratio = width > 0 && height > 0 ? width / height : 16 / 9;
  const w = Math.min(band.w, band.h * ratio);
  const h = w / ratio;
  return {
    band,
    arena: { x: band.x + (band.w - w) / 2, y: band.y + (band.h - h) / 2, w, h },
  };
}

function cardOf(card: RevealCard, side: Side, elapsedMs: number): ClipCard {
  const w = (CLIP_WIDTH - 2 * MARGIN - GAP) / 2;
  // Moi a gauche, comme dans l arene : le rig `a` est toujours ce joueur.
  const x = side === 'moi' ? MARGIN : MARGIN + w + GAP;
  const shown = elapsedMs >= card.atMs;

  let face: ClipCardFace;
  let scaleX = 1;
  let scale = 1;
  if (card.faceDown) {
    // La carte adverse est la des le debut, face cachee, puis se retourne.
    const turn = clamp01((elapsedMs - card.atMs) / CLIP_FLIP_MS);
    face = turn < 0.5 ? 'back' : 'front';
    scaleX = Math.abs(Math.cos(Math.PI * turn));
  } else {
    // La mienne n existe qu a son instant : elle claque en place.
    face = shown ? 'front' : 'hidden';
    scale = shown ? pop(elapsedMs, card.atMs) : 0;
  }

  return {
    side,
    rect: { x, y: CARD_TOP, w, h: CARD_H },
    face,
    scaleX,
    scale,
    label: side === 'moi' ? 'Moi' : 'Adversaire',
    tier: tierName(card.tier).fr,
    icon: card.icon,
    name: card.name,
    family: `${styleIcon(card.family)} ${styleName(card.family).fr}`,
    badge: card.shiny ? `✨ ${mult(BALANCE.shiny.multiplier)}` : null,
  };
}

function calloutText(callout: RevealCallout): { who: string; line: string; good: boolean } {
  switch (callout.kind) {
    case 'counter':
      return {
        who: callout.by === 'moi' ? 'Mon contre !' : 'Contré !',
        line: `${styleIcon(callout.winner)} BAT ${styleIcon(callout.loser)} · ${mult(callout.multiplier)}`,
        good: callout.by === 'moi',
      };
    case 'mirror':
      return {
        who: 'Même famille',
        line: `${styleIcon(callout.family)} MIROIR ${styleIcon(callout.family)}`,
        good: true,
      };
    case 'blocked':
      return {
        who: callout.by === 'moi' ? 'Mon Ultime' : 'Son Ultime',
        line: '🛡️ CONTRE BLOQUÉ',
        good: callout.by === 'moi',
      };
  }
}

function verdictTitle(winner: Side | null): string {
  if (winner === null) return 'Manche nulle';
  return winner === 'moi' ? 'Manche gagnée' : 'Manche perdue';
}

export function clipLayout({ scene, outcome, arena, elapsedMs }: ClipLayoutInput): ClipLayout {
  const { band, arena: picture } = fit(arena.width, arena.height);

  const calloutRect: Rect = {
    x: MARGIN,
    y: CALLOUT_TOP,
    w: CLIP_WIDTH - 2 * MARGIN,
    h: CALLOUT_H,
  };
  const callout =
    scene.callout !== null && elapsedMs >= scene.calloutAtMs
      ? {
          rect: calloutRect,
          kind: scene.callout.kind,
          ...calloutText(scene.callout),
          scale: pop(elapsedMs, scene.calloutAtMs),
        }
      : null;

  const verdictRect: Rect = {
    x: MARGIN,
    y: BAND_BOTTOM + GAP,
    w: CLIP_WIDTH - 2 * MARGIN,
    h: VERDICT_H,
  };
  const verdict =
    elapsedMs >= VERDICT_PANEL_AT_MS
      ? {
          rect: verdictRect,
          title: verdictTitle(outcome.winner),
          score: `${String(outcome.myScore)} – ${String(outcome.opponentScore)}`,
          won: outcome.winner === 'moi',
          scale: pop(elapsedMs, VERDICT_PANEL_AT_MS),
        }
      : null;

  return {
    band,
    arena: picture,
    cards: [cardOf(scene.mine, 'moi', elapsedMs), cardOf(scene.theirs, 'adversaire', elapsedMs)],
    callout,
    verdict,
    cta: {
      rect: { x: MARGIN, y: CLIP_HEIGHT - MARGIN - CTA_H, w: CLIP_WIDTH - 2 * MARGIN, h: CTA_H },
      text: 'Défie-moi sur',
      brand: 'Aura Battle',
    },
  };
}
