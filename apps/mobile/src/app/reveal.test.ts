import { BALANCE } from '@aura/rules';
import { describe, expect, it } from 'vitest';
import { CLASH_AT_MS, REVEAL_FIRST_AT_MS, REVEAL_GAP_MS } from '../arena/round.js';
import type { RoundView } from '../match/view.js';
import { revealScene } from './reveal.js';
import { defaultLook, type Wardrobe } from './wardrobe.js';

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
  opponentPoseId: null,
  counteredBy: 'moi',
  counterBlocked: false,
  revealFirst: 'adversaire',
  opponentQuality: 'good',
  opponentUltimate: false,
  ...over,
});

describe('revealScene', () => {
  it('montre ma pose et celle de l adversaire, avec leur pictogramme', () => {
    const scene = revealScene(round(), bare);
    expect(scene.mine).toMatchObject({ name: 'Roue', icon: '🤸', family: 'acrobatie', tier: 2 });
    expect(scene.theirs).toMatchObject({ name: 'Pompes', icon: '🏋️', family: 'prouesse', tier: 1 });
  });

  it('prend la vraie pose adverse quand le serveur la donne', () => {
    const scene = revealScene(
      round({ opponentMove: { style: 'provoc', tier: 2 }, opponentPoseId: 'anim.provoc.t2.shrug' }),
      bare,
    );
    expect(scene.theirs.name).toBe("Haussement d'épaules");
  });

  it('ignore une pose adverse qui ne correspond pas a son mouvement', () => {
    const scene = revealScene(round({ opponentPoseId: 'anim.hype.t2.floss' }), bare);
    expect(scene.theirs.name).toBe('Pompes');
  });

  it('revele dans l ordre du serveur, la carte adverse face cachee d abord', () => {
    const scene = revealScene(round({ revealFirst: 'adversaire' }), bare);
    expect(scene.theirs.atMs).toBe(REVEAL_FIRST_AT_MS);
    expect(scene.mine.atMs).toBe(REVEAL_FIRST_AT_MS + REVEAL_GAP_MS);
    expect(scene.theirs.faceDown).toBe(true);
    expect(scene.mine.faceDown).toBe(false);
    expect(revealScene(round({ revealFirst: 'moi' }), bare).mine.atMs).toBe(REVEAL_FIRST_AT_MS);
  });

  it('annonce mon contre au choc, du point de vue de la famille qui gagne', () => {
    const scene = revealScene(round(), bare);
    expect(scene.calloutAtMs).toBe(CLASH_AT_MS);
    expect(scene.callout).toEqual({
      kind: 'counter',
      by: 'moi',
      winner: 'acrobatie',
      loser: 'prouesse',
      multiplier: BALANCE.counter.winnerMultiplier,
    });
  });

  it('annonce le contre de l adversaire', () => {
    const scene = revealScene(
      round({
        myMove: { style: 'calme', tier: 2 },
        opponentMove: { style: 'provoc', tier: 2 },
        counteredBy: 'adversaire',
      }),
      bare,
    );
    expect(scene.callout).toMatchObject({
      kind: 'counter',
      by: 'adversaire',
      winner: 'provoc',
      loser: 'calme',
    });
  });

  it('annonce un miroir quand les familles sont les memes', () => {
    const scene = revealScene(
      round({ opponentMove: { style: 'acrobatie', tier: 0 }, counteredBy: null, countered: false }),
      bare,
    );
    expect(scene.callout).toEqual({ kind: 'mirror', family: 'acrobatie' });
  });

  it('annonce un contre bloque par l Ultime, et qui l a lache', () => {
    const scene = revealScene(
      round({ counteredBy: null, counterBlocked: true, opponentUltimate: true }),
      bare,
    );
    expect(scene.callout).toEqual({ kind: 'blocked', by: 'adversaire' });
  });

  it('fait eclater les cartes brillantes', () => {
    const scene = revealScene(round({ myShiny: true }), bare);
    expect(scene.mine.shiny).toBe(true);
    expect(scene.theirs.shiny).toBe(false);
  });
});
