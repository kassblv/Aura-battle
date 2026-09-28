import { BALANCE } from '@aura/rules';
import { describe, expect, it } from 'vitest';
import type { ArenaEvent } from './events.js';
import {
  VERDICT_PANEL_AT_MS,
  outcomeShown,
  verdictPanelShown,
  msUntilVerdictPanel,
  CLASH_AT_MS,
  REVEAL_FIRST_AT_MS,
  REVEAL_GAP_MS,
  VICTORY_AT_MS,
  roundChoreography,
  storyOfRound,
  type RoundReport,
  type RoundStory,
} from './round.js';
import { CLASH_DURATION_MS, CLASH_HIT_AT } from './clash.js';
import { REVEAL_FOCUS_MS } from './events.js';

const report = (over: Partial<RoundReport> = {}): RoundReport => ({
  round: 1,
  winner: 'moi',
  myScore: 62,
  opponentScore: 40,
  myQuality: 'good',
  myUltimate: false,
  countered: false,
  ...over,
});

const story = (over: Partial<RoundStory> = {}): RoundStory => ({
  round: 1,
  winner: 'a',
  revealFirst: 'b',
  sides: {
    a: { score: 62, quality: 'good', ultimate: false, counters: false },
    b: { score: 40, quality: 'good', ultimate: false, counters: false },
  },
  ...over,
});

describe('storyOfRound', () => {
  it('assoit le joueur de cet appareil sur le rig de gauche', () => {
    const s = storyOfRound(report({ winner: 'adversaire', myScore: 12, opponentScore: 99 }));
    expect(s.winner).toBe('b');
    expect(s.sides.a.score).toBe(12);
    expect(s.sides.b.score).toBe(99);
  });

  it('garde la manche nulle nulle', () => {
    expect(storyOfRound(report({ winner: null })).winner).toBeNull();
  });

  it('honore le timing et l Ultime de l adversaire quand la vue les porte', () => {
    const s = storyOfRound(
      report({ opponentQuality: 'perfect', opponentUltimate: true, myQuality: 'miss' }),
    );
    expect(s.sides.b.quality).toBe('perfect');
    expect(s.sides.b.ultimate).toBe(true);
    expect(s.sides.a.quality).toBe('miss');
  });

  it('honore `counteredBy` quand la vue le porte, meme contre le vainqueur', () => {
    // Le cas qui met le repli en defaut : le contre existe, et c est le PERDANT
    // qui l a porte — il contrait depuis trop loin pour rattraper l ecart.
    const s = storyOfRound(report({ winner: 'moi', countered: true, counteredBy: 'adversaire' }));
    expect(s.sides.b.counters).toBe(true);
    expect(s.sides.a.counters).toBe(false);
  });

  it('a defaut, attribue le contre au vainqueur', () => {
    const s = storyOfRound(report({ winner: 'adversaire', countered: true }));
    expect(s.sides.b.counters).toBe(true);
    expect(s.sides.a.counters).toBe(false);
  });

  it('ne contre personne sur une manche nulle sans indication', () => {
    const s = storyOfRound(report({ winner: null, countered: true }));
    expect(s.sides.a.counters).toBe(false);
    expect(s.sides.b.counters).toBe(false);
  });

  it('a defaut de `revealFirst`, l adversaire ouvre et le joueur conclut', () => {
    expect(storyOfRound(report()).revealFirst).toBe('b');
    expect(storyOfRound(report({ revealFirst: 'moi' })).revealFirst).toBe('a');
  });
});

describe('roundChoreography', () => {
  const types = (events: readonly { event: ArenaEvent }[]): string[] =>
    events.map((e) => e.event.type);

  it('revele, revele, percute, tranche — dans cet ordre', () => {
    const plan = roundChoreography(story());
    expect(types(plan)).toEqual(['reveal', 'reveal', 'clash', 'victory']);
    expect(plan.map((e) => e.atMs)).toEqual([
      REVEAL_FIRST_AT_MS,
      REVEAL_FIRST_AT_MS + REVEAL_GAP_MS,
      CLASH_AT_MS,
      VICTORY_AT_MS,
    ]);
  });

  /*
    Les deux danses doivent se VOIR avant le choc.

    La revelation durait 1 400 ms du premier geste au verdict : le second
    danseur avait 780 ms a l ecran, a peine une mesure, avant de basculer sur
    la joie ou l encaissement. C'est pourtant le moment qu'une aura battle
    existe pour montrer — deux memes, l'un en face de l'autre.
  */
  it('laisse danser le second revele plus d une seconde avant le contact', () => {
    const second = REVEAL_FIRST_AT_MS + REVEAL_GAP_MS;
    expect(VICTORY_AT_MS - second).toBeGreaterThanOrEqual(1_100);
  });

  it('laisse chaque cadrage de revelation finir avant le suivant et avant le choc', () => {
    expect(REVEAL_FOCUS_MS).toBeLessThanOrEqual(REVEAL_GAP_MS);
    expect(REVEAL_FIRST_AT_MS + REVEAL_GAP_MS + REVEAL_FOCUS_MS).toBeLessThanOrEqual(CLASH_AT_MS);
  });

  it('respecte l ordre de revelation annonce par le serveur', () => {
    const plan = roundChoreography(story({ revealFirst: 'a' }));
    expect(plan.slice(0, 2).map((e) => (e.event as { seat: string }).seat)).toEqual(['a', 'b']);
  });

  /*
    Le contact doit tomber sur le verdict, pas apres.

    L ecran bascule sur la pose de victoire 1 400 ms apres le debut de la
    revelation (`VERDICT_AFTER_MS`). Si les faisceaux se touchaient plus tard,
    le perdant chancellerait avant d avoir ete touche — et l image raconterait
    l inverse de ce qui se passe.
  */
  it('fait tomber le contact sur le verdict', () => {
    const contact = CLASH_AT_MS + CLASH_DURATION_MS * CLASH_HIT_AT;
    // Moins d une image d ecart a 60 i/s : les deux tombent ensemble.
    expect(Math.abs(contact - VICTORY_AT_MS)).toBeLessThan(16);
  });

  it('ne flashe que pour le joueur de cet appareil', () => {
    const plan = roundChoreography(story());
    const reveals = plan.filter((e) => e.event.type === 'reveal');
    expect(reveals.map((e) => (e.event as { local: boolean }).local)).toEqual([false, true]);
  });

  it('designe le siege qui a contre', () => {
    const plan = roundChoreography(
      story({
        sides: {
          a: { score: 62, quality: 'good', ultimate: false, counters: false },
          b: { score: 40, quality: 'good', ultimate: false, counters: true },
        },
      }),
    );
    const clash = plan.find((e) => e.event.type === 'clash')!.event;
    expect(clash).toMatchObject({ counter: 'b' });
  });

  it('designe le seul Ultime de la manche', () => {
    const plan = roundChoreography(
      story({
        sides: {
          a: { score: 90, quality: 'perfect', ultimate: true, counters: false },
          b: { score: 40, quality: 'good', ultimate: false, counters: false },
        },
      }),
    );
    expect(plan.find((e) => e.event.type === 'clash')!.event).toMatchObject({ ultimate: 'a' });
  });

  it('ne designe personne quand les deux lachent leur Ultime', () => {
    const plan = roundChoreography(
      story({
        sides: {
          a: { score: 90, quality: 'perfect', ultimate: true, counters: false },
          b: { score: 88, quality: 'good', ultimate: true, counters: false },
        },
      }),
    );
    expect(plan.find((e) => e.event.type === 'clash')!.event).toMatchObject({ ultimate: null });
  });
});

describe('outcomeShown — la joie et l encaissement attendent le contact', () => {
  it('attend le contact des faisceaux pendant la revelation', () => {
    expect(outcomeShown('reveal', VICTORY_AT_MS - 1)).toBe(false);
    expect(outcomeShown('reveal', VICTORY_AT_MS)).toBe(true);
  });

  it('reste acquis en fin de match, et absent ailleurs', () => {
    expect(outcomeShown('ended', 0)).toBe(true);
    expect(outcomeShown('choice', 10_000)).toBe(false);
  });
});

describe('panneau de verdict — il attend que le choc soit fini', () => {
  /*
    Le panneau se pose au centre de l'ecran, exactement la ou les deux
    faisceaux se rencontrent. Affiche des le debut de la revelation, il
    cachait le seul moment que toute la manche prepare.
  */
  it('ne couvre pas le choc', () => {
    expect(VERDICT_PANEL_AT_MS).toBeGreaterThanOrEqual(CLASH_AT_MS + CLASH_DURATION_MS);
    expect(verdictPanelShown('reveal', CLASH_AT_MS + CLASH_DURATION_MS / 2)).toBe(false);
  });

  it('apparait une fois le choc termine, et reste en fin de match', () => {
    expect(verdictPanelShown('reveal', VERDICT_PANEL_AT_MS)).toBe(true);
    expect(verdictPanelShown('ended', 0)).toBe(true);
  });

  it('n existe pas hors de la revelation', () => {
    expect(verdictPanelShown('choice', 10_000)).toBe(false);
    expect(verdictPanelShown('recharge', 10_000)).toBe(false);
  });

  it('laisse le temps de le lire avant la manche suivante', () => {
    expect(BALANCE.phases.revealMs - VERDICT_PANEL_AT_MS).toBeGreaterThanOrEqual(2_000);
  });
});

/*
  Le panneau se lit a l'horloge AU RENDU : sans un rendu programme a son
  instant, rien ne le faisait apparaitre avant la fin du match — les manches
  1 et 2 n'avaient jamais eu leur verdict.
*/
describe('msUntilVerdictPanel — le rendu qui fait tomber le verdict', () => {
  it('attend la fin du choc pendant la revelation', () => {
    expect(msUntilVerdictPanel('reveal', 0)).toBe(VERDICT_PANEL_AT_MS);
    expect(msUntilVerdictPanel('reveal', 500)).toBe(VERDICT_PANEL_AT_MS - 500);
  });

  it('ne programme rien une fois le panneau la, ni hors revelation', () => {
    expect(msUntilVerdictPanel('reveal', VERDICT_PANEL_AT_MS)).toBeNull();
    expect(msUntilVerdictPanel('choice', 0)).toBeNull();
    expect(msUntilVerdictPanel('ended', 0)).toBeNull();
  });
});
