import { variantConfig } from '@aura/rules';
import { describe, expect, it } from 'vitest';
import {
  CLASH_AT_MS,
  REVEAL_FIRST_AT_MS,
  REVEAL_GAP_MS,
  VERDICT_PANEL_AT_MS,
} from '../arena/round.js';
import { revealScene } from '../app/reveal.js';
import { defaultLook, type Wardrobe } from '../app/wardrobe.js';
import type { RoundView } from '../match/view.js';
import {
  CLIP_FLIP_MS,
  CLIP_HEIGHT,
  CLIP_POP_MS,
  CLIP_WIDTH,
  clipLayout,
  type ClipLayout,
  type Rect,
  CLIP_BADGE_SPACE,
} from './layout.js';

const bare: Wardrobe = { look: defaultLook(), owned: new Set() };

const round = (over: Partial<RoundView> = {}): RoundView => ({
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
  ...over,
});

const at = (elapsedMs: number, over: Partial<RoundView> = {}): ClipLayout => {
  const view = round(over);
  return clipLayout({
    scene: revealScene(view, bare),
    outcome: { winner: view.winner, myScore: view.myScore, opponentScore: view.opponentScore },
    arena: { width: 1688, height: 780 },
    elapsedMs,
  });
};

const inside = (inner: Rect, outer: Rect): boolean =>
  inner.x >= outer.x - 1e-6 &&
  inner.y >= outer.y - 1e-6 &&
  inner.x + inner.w <= outer.x + outer.w + 1e-6 &&
  inner.y + inner.h <= outer.y + outer.h + 1e-6;

const overlaps = (a: Rect, b: Rect): boolean =>
  a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

const frame: Rect = { x: 0, y: 0, w: CLIP_WIDTH, h: CLIP_HEIGHT };

describe('clipLayout : la mise en page', () => {
  it('est verticale, au format des videos courtes', () => {
    expect(CLIP_WIDTH / CLIP_HEIGHT).toBeCloseTo(9 / 16);
  });

  it('montre l arene ENTIERE, a son rapport, dans une bande de toute la largeur', () => {
    const layout = at(0);
    expect(layout.band.w).toBe(CLIP_WIDTH);
    expect(layout.arena.w / layout.arena.h).toBeCloseTo(1688 / 780);
    expect(inside(layout.arena, layout.band)).toBe(true);
    // Une arene paysage prend toute la largeur : elle est bordee dessus-dessous.
    expect(layout.arena.w).toBe(CLIP_WIDTH);
  });

  it('borde une arene plus haute sur les cotes au lieu de la recadrer', () => {
    const view = round();
    const layout = clipLayout({
      scene: revealScene(view, bare),
      outcome: { winner: 'moi', myScore: 1, opponentScore: 0 },
      arena: { width: 800, height: 800 },
      elapsedMs: 0,
    });
    expect(layout.arena.w / layout.arena.h).toBeCloseTo(1);
    expect(layout.arena.h).toBe(layout.band.h);
    expect(layout.arena.x).toBeGreaterThan(0);
    expect(inside(layout.arena, layout.band)).toBe(true);
  });

  it('pose les cartes et le bandeau au-dessus, le verdict et l appel en dessous', () => {
    const layout = at(VERDICT_PANEL_AT_MS + 1_000);
    const top = [...layout.cards.map((card) => card.rect), layout.callout?.rect];
    const bottom = [layout.verdict?.rect, layout.cta.rect];
    for (const rect of top) {
      expect(rect).toBeDefined();
      if (rect === undefined) continue;
      expect(rect.y + rect.h).toBeLessThanOrEqual(layout.band.y);
      expect(inside(rect, frame)).toBe(true);
    }
    for (const rect of bottom) {
      expect(rect).toBeDefined();
      if (rect === undefined) continue;
      expect(rect.y).toBeGreaterThanOrEqual(layout.band.y + layout.band.h);
      expect(inside(rect, frame)).toBe(true);
    }
    const [mine, theirs] = layout.cards;
    expect(mine && theirs && overlaps(mine.rect, theirs.rect)).toBe(false);
    if (layout.verdict !== null) expect(overlaps(layout.verdict.rect, layout.cta.rect)).toBe(false);
  });

  it('met ma carte a gauche, comme mon personnage dans l arene', () => {
    const [mine, theirs] = at(0).cards;
    expect(mine?.side).toBe('moi');
    expect(theirs?.side).toBe('adversaire');
    expect(mine?.rect.x ?? 0).toBeLessThan(theirs?.rect.x ?? 0);
  });

  it('ne publie aucun nom de joueur', () => {
    const labels = at(VERDICT_PANEL_AT_MS).cards.map((card) => card.label);
    expect(labels).toEqual(['Moi', 'Adversaire']);
  });
});

describe('clipLayout : la chronologie suit celle de la revelation', () => {
  // En solo, l adversaire ouvre et ma revelation ferme la scene.
  const theirsAt = REVEAL_FIRST_AT_MS;
  const mineAt = REVEAL_FIRST_AT_MS + REVEAL_GAP_MS;

  it('montre la carte adverse face cachee des le debut, puis la retourne a son instant', () => {
    expect(at(0).cards[1]).toMatchObject({ face: 'back', scaleX: 1 });
    expect(at(theirsAt + CLIP_FLIP_MS / 4).cards[1]?.face).toBe('back');
    expect(at(theirsAt + CLIP_FLIP_MS / 2).cards[1]?.scaleX).toBeCloseTo(0);
    expect(at(theirsAt + CLIP_FLIP_MS).cards[1]).toMatchObject({ face: 'front', scaleX: 1 });
    expect(at(theirsAt + CLIP_FLIP_MS).cards[1]).toMatchObject({ name: 'Pompes', icon: '🏋️' });
  });

  it('fait claquer ma carte a mon instant, pas avant', () => {
    expect(at(mineAt - 1).cards[0]).toMatchObject({ face: 'hidden', scale: 0 });
    expect(at(mineAt).cards[0]?.face).toBe('front');
    expect(at(mineAt + CLIP_POP_MS).cards[0]?.scale).toBeCloseTo(1);
    expect(at(mineAt + CLIP_POP_MS).cards[0]).toMatchObject({ name: 'Roue', icon: '🤸' });
  });

  it('suit l ordre du serveur quand je me revele en premier', () => {
    expect(at(REVEAL_FIRST_AT_MS, { revealFirst: 'moi' }).cards[0]?.face).toBe('front');
  });

  it('annonce le contre au choc, avec son multiplicateur ecrit a la francaise', () => {
    expect(at(CLASH_AT_MS - 1).callout).toBeNull();
    expect(at(CLASH_AT_MS).callout).toMatchObject({
      kind: 'counter',
      who: 'Mon contre !',
      line: '🤸 BAT 💪 · ×1,35',
      good: true,
    });
  });

  it('dit le contre subi, le miroir et le contre bloque', () => {
    const t = CLASH_AT_MS + CLIP_POP_MS;
    expect(at(t, { counteredBy: 'adversaire', winner: 'adversaire' }).callout).toMatchObject({
      who: 'Contré !',
      good: false,
    });
    expect(
      at(t, {
        counteredBy: null,
        countered: false,
        opponentMove: { style: 'acrobatie', tier: 1 },
      }).callout,
    ).toMatchObject({ kind: 'mirror', line: '🤸 MIROIR 🤸' });
    expect(at(t, { counteredBy: null, counterBlocked: true }).callout).toMatchObject({
      kind: 'blocked',
      line: '🛡️ CONTRE BLOQUÉ',
    });
  });

  it('n a pas de bandeau quand rien ne se contre', () => {
    const plain = {
      counteredBy: null,
      countered: false,
      opponentMove: { style: 'provoc', tier: 1 },
    };
    expect(at(CLASH_AT_MS + 500, plain as Partial<RoundView>).callout).toBeNull();
  });

  it('tombe le verdict avec le panneau de l ecran', () => {
    expect(at(VERDICT_PANEL_AT_MS - 1).verdict).toBeNull();
    expect(at(VERDICT_PANEL_AT_MS).verdict).toMatchObject({
      title: 'Manche gagnée',
      score: '50 – 30',
      won: true,
    });
  });

  it('garde l appel au duel du debut a la fin', () => {
    for (const t of [0, CLASH_AT_MS, VERDICT_PANEL_AT_MS + 900]) {
      expect(at(t).cta).toMatchObject({ text: 'Défie-moi sur', brand: 'Aura Battle' });
    }
  });

  it('annonce la brillante sur sa carte', () => {
    expect(at(0).cards[0]?.badge).toBeNull();
    expect(at(0, { myShiny: true }).cards[0]?.badge).toBe('✨ ×1,2');
  });

  /*
    Le badge de la brillante se dessine SOUS la carte (composer) : sans place
    reservee, il mordait le cadre et touchait le bandeau du contre (vu a
    l'ecran sur une image du clip).
  */
  it('reserve au badge sa place entre la carte et le bandeau', () => {
    const layout = at(VERDICT_PANEL_AT_MS, { myShiny: true });
    const card = layout.cards[0]!.rect;
    const callout = layout.callout!.rect;
    expect(callout.y - (card.y + card.h)).toBeGreaterThanOrEqual(CLIP_BADGE_SPACE);
  });
});

describe('clipLayout : les regles du match', () => {
  const played = (variant: string, over: Partial<RoundView> = {}): ClipLayout => {
    const view = round(over);
    return clipLayout({
      scene: revealScene(view, bare, variantConfig(variant)),
      outcome: { winner: view.winner, myScore: view.myScore, opponentScore: view.opponentScore },
      arena: { width: 1688, height: 780 },
      elapsedMs: VERDICT_PANEL_AT_MS + 1000,
    });
  };

  it('ecrit ✨ ×1,5 sur la brillante pendant la Semaine brillante', () => {
    const mine = played('brillance', { myShiny: true }).cards.find((card) => card.side === 'moi');
    expect(mine?.badge).toBe('✨ ×1,5');
  });

  it('ecrit ×1,6 au bandeau du contre pendant Contres tranchants', () => {
    expect(JSON.stringify(played('contres').callout)).toContain('×1,6');
  });
});
