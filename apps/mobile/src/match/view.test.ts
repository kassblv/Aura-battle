import { BALANCE } from '@aura/rules';
import { describe, expect, it } from 'vitest';
import { viewOfSolo } from './view.js';
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
