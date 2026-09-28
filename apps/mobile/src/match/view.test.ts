import { BALANCE } from '@aura/rules';
import { describe, expect, it } from 'vitest';
import { EMPTY_ONLINE_STATE, type OnlineMatch } from './online.js';
import { viewOfOnline, viewOfSolo } from './view.js';
import { createSoloMatch, type SoloMatch } from './solo.js';

const solo = (): SoloMatch => createSoloMatch({ seed: 'vue', opponent: 'calm', startedAtMs: 0 });

function runTo(match: SoloMatch, phase: string, limit = 40): void {
  for (let i = 0; i < limit && match.state.phase !== phase; i++) {
    match.advanceTo(match.state.phaseEndsAtMs);
  }
}

describe('viewOfSolo', () => {
  it('rend la phase et la manche du moteur', () => {
    const match = solo();
    const view = viewOfSolo(match);
    expect(view.phase).toBe('intro');
    expect(view.round).toBe(1);
  });

  it('donne la duree de la phase, que le moteur n annonce pas', () => {
    // Le moteur dit quand la phase finit, pas depuis quand elle dure : sans
    // cette duree, aucune barre de progression n est possible.
    const match = solo();
    expect(viewOfSolo(match).phaseDurationMs).toBe(BALANCE.phases.introMs);
    runTo(match, 'recharge');
    expect(viewOfSolo(match).phaseDurationMs).toBe(BALANCE.recharge.durationMs);
  });

  /**
   * L energie de l adversaire n est **jamais** montree.
   *
   * Le protocole ne l envoie pas : `round:intro` ne porte que celle du
   * destinataire. L afficher en solo, ou le client fait tourner le moteur et
   * pourrait donc la lire, apprendrait au joueur a compter sur une information
   * qui disparait des qu il joue en ligne.
   */
  it('cache l energie de l adversaire, meme quand le client pourrait la lire', () => {
    const view = viewOfSolo(solo());
    expect(view.opponent.energy).toBeNull();
    expect(view.me.energy).toBe(BALANCE.match.startingEnergy);
  });

  it('montre les manches gagnees des deux cotes', () => {
    // Le score de la partie est public : c est le seul compteur partage.
    const view = viewOfSolo(solo());
    expect(view.me.roundsWon).toBe(0);
    expect(view.opponent.roundsWon).toBe(0);
  });

  it('expose les orbes et les taps declares pendant la recharge', () => {
    const match = solo();
    runTo(match, 'recharge');
    const view = viewOfSolo(match);
    expect(view.orbs.length).toBeGreaterThan(0);
    expect(view.taps).toEqual([]);

    const first = view.orbs[0];
    if (first === undefined) throw new Error('aucune orbe');
    match.tap([{ atMs: 120, orbIndex: first.index }], 120);
    expect(viewOfSolo(match).taps).toHaveLength(1);
  });

  it('donne la periode de la jauge pendant le choix', () => {
    const match = solo();
    runTo(match, 'choice');
    expect(viewOfSolo(match).meterPeriodMs).toBeGreaterThan(0);
  });

  it('rend le resultat de la manche du point de vue du joueur', () => {
    const match = solo();
    runTo(match, 'reveal');
    const view = viewOfSolo(match);
    expect(view.lastRound).not.toBeNull();
    expect(typeof view.lastRound?.myScore).toBe('number');
    expect(typeof view.lastRound?.opponentScore).toBe('number');
  });

  it('dit qui gagne en « moi » ou « adversaire », jamais en siege', () => {
    // L interface ne doit pas avoir a savoir quel siege elle occupe : c est
    // exactement la ou l on inverse les scores un jour de fatigue.
    const match = solo();
    for (let i = 0; i < 60 && match.state.phase !== 'ended'; i++) {
      match.advanceTo(match.state.phaseEndsAtMs);
    }
    const view = viewOfSolo(match);
    expect(view.ended).not.toBeNull();
    expect(['moi', 'adversaire', null]).toContain(view.ended?.winner ?? null);
  });

  it('ne signale aucun verrouillage adverse hors phase de choix', () => {
    expect(viewOfSolo(solo()).opponentLocked).toBe(false);
  });
});

describe('jauge d Ultime', () => {
  /**
   * L Ultime etait invisible et inutilisable.
   *
   * La vue ne portait pas la jauge et l ecran envoyait `useUltimate: false` en
   * dur : le joueur ne pouvait ni la voir se remplir, ni s en servir. C est
   * pourtant la mecanique qui decide d une manche — ×1,5 et **impossible a
   * contrer** (`docs/01` §6).
   */
  it('montre au joueur sa propre jauge', () => {
    const match = solo();
    runTo(match, 'recharge');
    const vue = viewOfSolo(match);
    expect(vue.me.ultimate).toBeGreaterThanOrEqual(0);
    expect(vue.me.ultimate).toBeLessThanOrEqual(BALANCE.ultimate.gaugeMax);
  });

  /**
   * Regle d or n°4 : celle de l adversaire ne sort jamais.
   *
   * Le protocole refuse deja un `round:intro` qui porterait l `ult` adverse —
   * un test de `@aura/protocol` le verrouille. L afficher en solo, ou le client
   * fait tourner le moteur et pourrait donc la lire, apprendrait au joueur a
   * compter sur une information qui disparait des qu il joue en ligne.
   */
  it('cache celle de l adversaire, toujours', () => {
    const match = solo();
    runTo(match, 'choice');
    expect(viewOfSolo(match).opponent.ultimate).toBeNull();
  });
});

describe('carte brillante dans la vue', () => {
  it('montre ma case brillante en solo, et jamais celle de l adversaire', () => {
    const match = solo();
    runTo(match, 'choice');
    const view = viewOfSolo(match);
    expect(view.me.shiny).toEqual(match.state.roundContext?.shiny.a);
    expect(view.opponent.shiny).toBeNull();
  });

  it('n en montre aucune hors d une manche', () => {
    expect(viewOfSolo(solo()).me.shiny).toBeNull();
  });

  it('dit apres la manche qui a joue sa brillante', () => {
    const match = solo();
    runTo(match, 'choice');
    const shiny = match.state.roundContext!.shiny.a;
    match.lock(
      { move: shiny, amplifier: 0, useUltimate: false },
      null,
      match.state.phaseEndsAtMs - 1,
    );
    runTo(match, 'reveal');
    expect(viewOfSolo(match).lastRound?.myShiny).toBe(true);
    expect(typeof viewOfSolo(match).lastRound?.opponentShiny).toBe('boolean');
  });
});

describe('ce que la revelation raconte (chantier n°3)', () => {
  it('dit en solo les deux mouvements, qui a contre, et qui se revele d abord', () => {
    const match = solo();
    runTo(match, 'choice');
    match.lock({ move: { style: 'calme', tier: 1 }, amplifier: 0, useUltimate: false }, null, 1);
    runTo(match, 'reveal');
    const last = viewOfSolo(match).lastRound!;
    expect(last.myMove).toEqual({ style: 'calme', tier: 1 });
    expect(BALANCE.styles).toContain(last.opponentMove.style);
    expect(last.opponentPoseId).toBeNull();
    expect(last.myPoseId).toBeNull();
    // Solo : l'adversaire ouvre, le joueur ferme la scene.
    expect(last.revealFirst).toBe('adversaire');
    const record = match.state.history.at(-1)!;
    const expected = record.seats.a.countered
      ? 'moi'
      : record.seats.b.countered
        ? 'adversaire'
        : null;
    expect(last.counteredBy).toBe(expected);
  });

  it('reprend en ligne tout ce que round:result porte', () => {
    const side = (style: 'calme' | 'hype', counter: boolean) => ({
      move: { style, tier: 2 as const },
      amp: 0,
      ult: false,
      cosmetic: { animationId: `anim.${style}.t2.x`, effectId: 'fx.glow' },
      recharge: { points: 1, bestCombo: 1, boostPct: 0, ultGain: 0, energyGain: 0 },
      timing: { quality: 'good' as const, error: 0.1 },
      repeat: false,
      counter,
      countered: !counter,
      counterBlocked: false,
      shiny: false,
      base: 30,
      final: counter ? 40 : 25,
      energyAfter: 10,
      ultAfter: 0,
    });
    const match = {
      state: {
        ...EMPTY_ONLINE_STATE,
        seat: 'b',
        phase: 'reveal',
        lastRound: {
          matchId: 'm_1',
          round: 1,
          sides: { a: side('calme', true), b: side('hype', false) },
          winner: 'a',
          roundsWon: { a: 1, b: 0 },
          timeline: { revealFirst: 'b' },
        },
      },
    } as unknown as OnlineMatch;
    const last = viewOfOnline(match).lastRound!;
    expect(last.myMove).toEqual({ style: 'hype', tier: 2 });
    expect(last.opponentMove).toEqual({ style: 'calme', tier: 2 });
    expect(last.opponentPoseId).toBe('anim.calme.t2.x');
    // Ma pose aussi vient du serveur : c'est elle qu'il a jouee, et que l'adversaire voit.
    expect(last.myPoseId).toBe('anim.hype.t2.x');
    expect(last.counteredBy).toBe('adversaire');
    expect(last.counterBlocked).toBe(false);
    expect(last.revealFirst).toBe('moi');
    expect(last.opponentQuality).toBe('good');
    expect(last.opponentUltimate).toBe(false);
  });
});

describe('les regles du match dans la vue', () => {
  const online = (rulesVariant: string | null): OnlineMatch =>
    ({ state: { ...EMPTY_ONLINE_STATE, rulesVariant } }) as unknown as OnlineMatch;

  it('expose la config et l evenement de la variante en ligne', () => {
    const view = viewOfOnline(online('ultime'));
    expect(view.rules.ultimate.gaugeMax).toBe(60);
    expect(view.event?.name).toBe('Ultime express');
  });

  it('joue les regles normales sans variante', () => {
    const view = viewOfOnline(online(null));
    expect(view.rules).toBe(BALANCE);
    expect(view.event).toBeNull();
  });

  it('le solo garde les regles normales et n annonce aucun evenement', () => {
    const view = viewOfSolo(solo());
    expect(view.rules).toBe(BALANCE);
    expect(view.event).toBeNull();
  });
});

describe('bulle d intention dans la vue', () => {
  const online = (over: Record<string, unknown>): OnlineMatch =>
    ({ state: { ...EMPTY_ONLINE_STATE, seat: 'a', ...over } }) as unknown as OnlineMatch;

  it('rien quand le match n a pas de bulle', () => {
    expect(viewOfOnline(online({ phase: 'choice' })).intent).toBeNull();
  });

  it('le solo n a pas de bulle', () => {
    expect(viewOfSolo(solo()).intent).toBeNull();
  });

  it('expose les deux annonces et le droit d annoncer', () => {
    const view = viewOfOnline(
      online({ intentBubble: true, phase: 'choice', intents: { mine: null, theirs: 'hype' } }),
    );
    expect(view.intent).toEqual({ mine: null, theirs: 'hype', canAnnounce: true });
  });

  it('retire le droit d annoncer : deja annonce, envoye, verrouille ou hors choix', () => {
    const base = { intentBubble: true, phase: 'choice' };
    const can = (over: Record<string, unknown>): boolean | undefined =>
      viewOfOnline(online({ ...base, ...over })).intent?.canAnnounce;
    expect(can({ intents: { mine: 'calme', theirs: null } })).toBe(false);
    expect(can({ intentSent: true })).toBe(false);
    expect(can({ lockedSelf: true })).toBe(false);
    expect(can({ phase: 'recharge' })).toBe(false);
  });

  it('dit si MA bulle a ete tenue, selon mon siege', () => {
    const side = (intentKept?: boolean) => ({
      move: { style: 'calme', tier: 1 },
      amp: 0,
      ult: false,
      cosmetic: { animationId: 'anim.calme.t1.x', effectId: 'fx.glow' },
      recharge: { points: 1, bestCombo: 1, boostPct: 0, ultGain: 0, energyGain: 0 },
      timing: { quality: 'good' as const, error: 0.1 },
      repeat: false,
      counter: false,
      countered: false,
      counterBlocked: false,
      base: 30,
      final: 30,
      energyAfter: 10,
      ultAfter: 0,
      ...(intentKept === undefined ? {} : { intentKept }),
    });
    const lastRound = (a: boolean | undefined, b: boolean | undefined) => ({
      matchId: 'm_1',
      round: 1,
      sides: { a: side(a), b: side(b) },
      winner: 'b',
      roundsWon: { a: 0, b: 1 },
      timeline: { revealFirst: 'a' },
    });
    const kept = (seat: 'a' | 'b', a?: boolean, b?: boolean): boolean | undefined =>
      viewOfOnline(online({ seat, phase: 'reveal', lastRound: lastRound(a, b) })).lastRound
        ?.myIntentKept;
    expect(kept('b', false, true)).toBe(true);
    expect(kept('a', false, true)).toBe(false);
    // Un serveur d'avant 2.6.0 ne dit rien : pas de badge.
    expect(kept('a')).toBe(false);
  });
});
