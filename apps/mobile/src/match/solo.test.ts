import { BALANCE, type Choice } from '@aura/rules';
import { describe, expect, it } from 'vitest';
import { createSoloMatch, type SoloMatch } from './solo.js';

const choice = (style: 'calme' | 'hype' | 'provoc', tier: 0 | 1 | 2 | 3 | 4 = 2): Choice => ({
  move: { style, tier },
  amplifier: 0,
  useUltimate: false,
});

const solo = (seed = 'test'): SoloMatch =>
  createSoloMatch({ seed, opponent: 'calm', startedAtMs: 0 });

/** Amene le match jusqu a la phase demandee, en laissant les delais expirer. */
function runTo(match: SoloMatch, phase: string, limit = 40): void {
  for (let i = 0; i < limit && match.state.phase !== phase; i++) {
    match.advanceTo(match.state.phaseEndsAtMs);
  }
}

describe('createSoloMatch', () => {
  it('ouvre sur l intro de la premiere manche', () => {
    const match = solo();
    expect(match.state.phase).toBe('intro');
    expect(match.state.round).toBe(1);
  });

  it('enchaine intro, recharge, choix', () => {
    const match = solo();
    match.advanceTo(match.state.phaseEndsAtMs);
    expect(match.state.phase).toBe('recharge');
    match.advanceTo(match.state.phaseEndsAtMs);
    expect(match.state.phase).toBe('choice');
  });

  it('n avance pas tant que l echeance n est pas passee', () => {
    const match = solo();
    match.advanceTo(match.state.phaseEndsAtMs - 1);
    expect(match.state.phase).toBe('intro');
  });
});

describe('l adversaire joue seul', () => {
  it('recharge sans qu on le lui demande', () => {
    const match = solo();
    runTo(match, 'choice');
    expect(match.state.pending.b.taps.length).toBeGreaterThan(0);
  });

  it('verrouille son choix avant la fin de la phase', () => {
    const match = solo();
    runTo(match, 'choice');
    match.advanceTo(match.state.phaseEndsAtMs);
    // La manche se resout : l adversaire n a pas attendu qu on le pousse.
    expect(match.state.history).toHaveLength(1);
  });

  /**
   * L IA ne voit pas le choix en cours.
   *
   * C est la meme regle que sur le reseau (regle d or n°4) : le choix adverse
   * n existe pas avant la revelation. Une IA locale qui lirait `pending`
   * tricherait sans qu aucun test de score ne s en apercoive — elle gagnerait
   * simplement un peu trop souvent.
   */
  it('decide la meme chose que le joueur ait verrouille ou non', () => {
    const early = solo('fuite');
    runTo(early, 'choice');
    early.lock(choice('hype', 4), 500, early.state.phaseEndsAtMs - 100);
    early.advanceTo(early.state.phaseEndsAtMs);

    const late = solo('fuite');
    runTo(late, 'choice');
    late.advanceTo(late.state.phaseEndsAtMs);

    expect(early.state.seats.b.moves[0]).toEqual(late.state.seats.b.moves[0]);
  });
});

describe('les entrees du joueur', () => {
  it('compte les orbes tapees', () => {
    const match = solo();
    match.advanceTo(match.state.phaseEndsAtMs);
    const orbs = match.state.roundContext?.orbs ?? [];
    const first = orbs[0];
    if (first === undefined) throw new Error('aucune orbe');
    // L instant d un tap se compte depuis le debut de la phase de recharge.
    match.tap([{ atMs: 120, orbIndex: first.index }], 120);
    expect(match.state.pending.a.taps.length).toBeGreaterThan(0);
  });

  it('accepte un choix, puis refuse le suivant', () => {
    const match = solo();
    runTo(match, 'choice');
    expect(match.lock(choice('calme'), 400, 10)).toBe(true);
    // Le second verrouillage n est pas une correction : c est une tentative.
    expect(match.lock(choice('hype', 4), 400, 20)).toBe(false);
  });

  it('refuse un choix hors de la phase de choix', () => {
    const match = solo();
    expect(match.lock(choice('calme'), null, 10)).toBe(false);
  });

  /**
   * Le plafond par manche vaut exactement palier 4 + amplificateur 4 : rien
   * n est donc jamais trop cher en soi. Ce qui manque, c est l energie — et
   * elle ne se recharge pas d une manche a l autre.
   */
  it('refuse un choix que l energie restante ne couvre plus', () => {
    const match = solo();
    const full: Choice = { move: { style: 'calme', tier: 4 }, amplifier: 4, useUltimate: false };
    expect(full.move.tier + full.amplifier).toBe(BALANCE.maxRoundCost);

    runTo(match, 'choice');
    expect(match.lock(full, 400, 10)).toBe(true);
    match.advanceTo(match.state.phaseEndsAtMs);

    // Il reste 6 d energie : le meme choix en coute 8.
    runTo(match, 'choice');
    expect(match.state.seats.a.energy).toBeLessThan(BALANCE.maxRoundCost);
    expect(match.lock(full, 400, 10)).toBe(false);
  });

  it('joue le style par defaut pour qui ne verrouille pas', () => {
    const match = solo();
    runTo(match, 'choice');
    const fallback = match.state.roundContext?.defaultStyle;
    match.advanceTo(match.state.phaseEndsAtMs);
    // `moves` n est rempli qu a la resolution : c est le mouvement reellement joue.
    expect(match.state.seats.a.moves[0]?.style).toBe(fallback);
  });
});

describe('deroulement complet', () => {
  it('va jusqu au bout et designe un vainqueur', () => {
    const match = solo('partie');
    for (let i = 0; i < 60 && match.state.phase !== 'ended'; i++) {
      match.advanceTo(match.state.phaseEndsAtMs);
    }
    expect(match.state.phase).toBe('ended');
    expect(match.state.result).not.toBeNull();
    expect(match.state.history.length).toBeGreaterThanOrEqual(2);
  });

  it('se rejoue a l identique a graine et entrees egales', () => {
    const play = (): unknown => {
      const match = solo('rejeu');
      for (let i = 0; i < 60 && match.state.phase !== 'ended'; i++) {
        match.advanceTo(match.state.phaseEndsAtMs);
      }
      return match.state.result;
    };
    expect(play()).toEqual(play());
  });

  it('rend les effets du moteur, sans les accumuler indefiniment', () => {
    const match = solo();
    match.advanceTo(match.state.phaseEndsAtMs);
    expect(match.effects.some((e) => e.type === 'PHASE_STARTED')).toBe(true);
    const before = match.effects.length;
    match.advanceTo(match.state.phaseEndsAtMs);
    // Chaque avancee rend ses propres effets : sinon le client rejoue des
    // transitions deja consommees a chaque image.
    expect(match.effects.length).toBeLessThanOrEqual(before + 8);
  });
});
