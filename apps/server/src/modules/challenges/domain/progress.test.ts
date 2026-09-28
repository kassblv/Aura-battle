import { CHALLENGES, type ChallengeDefinition } from '@aura/content';
import { describe, expect, it } from 'vitest';
import {
  advance,
  claimOutcome,
  emptyContribution,
  mergeContributions,
  roundContribution,
  type MatchContribution,
  type RoundFacts,
  type StoredProgress,
} from './progress.js';

const contribution = (over: Partial<MatchContribution> = {}): MatchContribution => ({
  ...emptyContribution(),
  ...over,
});

const definition = (id: string): ChallengeDefinition => {
  const found = CHALLENGES.find((challenge) => challenge.id === id);
  if (found === undefined) throw new Error(`defi absent du catalogue : ${id}`);
  return found;
};

describe('advance', () => {
  /*
    Une mesure cumulable s'ajoute : deux parties a deux contres font quatre
    contres. C'est le cas de quatre mesures sur cinq.
  */
  it('additionne ce qui se cumule', () => {
    const counter = definition('challenge.counter.5');
    expect(advance(counter, 0, contribution({ counters: 2 }))).toBe(2);
    expect(advance(counter, 2, contribution({ counters: 3 }))).toBe(5);
  });

  /*
    Un combo est un MAXIMUM. Quatre parties a trois de combo ne valent pas un
    combo de douze — et cumuler rendrait trivial le defi le plus dur de la
    liste, sans que rien ne le signale.
  */
  it('garde le meilleur, pour ce qui ne se cumule pas', () => {
    const combo = definition('challenge.combo.14');
    expect(advance(combo, 0, contribution({ bestCombo: 9 }))).toBe(9);
    expect(advance(combo, 9, contribution({ bestCombo: 4 }))).toBe(9);
    expect(advance(combo, 9, contribution({ bestCombo: 12 }))).toBe(12);
  });

  /*
    On ne compte jamais au-dela de la cible. Sans plafond, une barre de
    progression afficherait 1400 sur 900 et un joueur y lirait un bogue —
    et le jour ou une recompense se calculerait sur le depassement, il
    deviendrait payant de jouer apres avoir fini.
  */
  it('ne depasse pas la cible', () => {
    const recharge = definition('challenge.recharge.400');
    expect(advance(recharge, 0, contribution({ rechargePoints: 1_000 }))).toBe(400);
    expect(advance(recharge, 390, contribution({ rechargePoints: 50 }))).toBe(400);
  });

  it('ne recule jamais', () => {
    const wins = definition('challenge.win.3');
    expect(advance(wins, 2, contribution())).toBe(2);
    expect(advance(wins, 2, contribution({ wins: 0 }))).toBe(2);
  });

  /*
    Une partie sans rien ne fait rien avancer. Evident, et pourtant c'est le
    cas qui distingue « on ajoute la contribution » de « on ecrase avec la
    contribution » : la seconde ramenerait la progression a zero.
  */
  /*
    Une partie sans rien ne fait rien avancer. Evident, et pourtant c'est le
    cas qui distingue « on ajoute la contribution » de « on ecrase avec la
    contribution » : la seconde ramenerait la progression a zero.

    La progression de depart est bornee par la cible — « trois » sur un defi
    qui en demande deux est un etat que le plafond interdit, et l'ecrire
    faisait echouer ce test pour une raison qui n'avait rien a voir avec ce
    qu'il verifie.
  */
  it('laisse la progression intacte apres une partie vide', () => {
    for (const challenge of CHALLENGES) {
      const started = Math.min(3, challenge.target);
      expect(advance(challenge, started, contribution()), challenge.id).toBe(started);
    }
  });

  it('refuse une contribution negative', () => {
    const counter = definition('challenge.counter.2');
    expect(advance(counter, 1, contribution({ counters: -5 }))).toBe(1);
  });
});

describe('claimOutcome', () => {
  const stored = (challengeId: string, progress: number, claimed = false): StoredProgress => ({
    challengeId,
    progress,
    claimed,
  });

  const today = [
    definition('challenge.win.1'),
    definition('challenge.counter.5'),
    definition('challenge.combo.14'),
  ];

  it('paie un defi termine et jamais reclame', () => {
    expect(claimOutcome(today, [stored('challenge.win.1', 1)], 'challenge.win.1')).toEqual({
      status: 'granted',
      reward: definition('challenge.win.1').reward,
    });
  });

  /*
    L'ordre des refus compte : « deja reclame » avant « pas fini ».

    Un double appui sur un bouton de recompense est la chose la plus courante
    du monde. Repondre « pas fini » a quelqu'un qui vient d'encaisser lui
    ferait croire que sa progression a ete perdue — alors qu'elle a ete payee.
  */
  it('refuse un defi deja reclame avant de regarder s il est fini', () => {
    expect(claimOutcome(today, [stored('challenge.win.1', 0, true)], 'challenge.win.1')).toEqual({
      status: 'already-claimed',
    });
  });

  it('refuse un defi non termine', () => {
    expect(claimOutcome(today, [stored('challenge.counter.5', 4)], 'challenge.counter.5')).toEqual({
      status: 'incomplete',
    });
  });

  it('refuse un defi sans la moindre progression', () => {
    expect(claimOutcome(today, [], 'challenge.counter.5')).toEqual({ status: 'incomplete' });
  });

  /*
    Un defi qui n'est pas de la journee ne se reclame pas, meme fini hier :
    la progression d'hier appartient a hier. Sans cette garde, garder l'ecran
    ouvert par-dessus minuit suffirait a encaisser deux fois le meme objectif.
  */
  it('refuse un defi absent de la journee', () => {
    expect(claimOutcome(today, [stored('challenge.win.3', 3)], 'challenge.win.3')).toEqual({
      status: 'unknown',
    });
  });

  it('refuse un identifiant qui n existe pas', () => {
    expect(claimOutcome(today, [], 'challenge.inexistant')).toEqual({ status: 'unknown' });
  });
});

describe('roundContribution', () => {
  const outcome = (over: Partial<RoundFacts> = {}): RoundFacts => ({
    countered: false,
    perfect: false,
    rechargePoints: 0,
    bestCombo: 0,
    ...over,
  });

  it('compte un contre reussi, pas un contre subi', () => {
    expect(roundContribution(outcome({ countered: true })).counters).toBe(1);
    expect(roundContribution(outcome()).counters).toBe(0);
  });

  it('compte un timing parfait', () => {
    expect(roundContribution(outcome({ perfect: true })).perfects).toBe(1);
    expect(roundContribution(outcome()).perfects).toBe(0);
  });

  it('reprend les chiffres de la recharge', () => {
    const contributed = roundContribution(outcome({ rechargePoints: 180, bestCombo: 7 }));
    expect(contributed.rechargePoints).toBe(180);
    expect(contributed.bestCombo).toBe(7);
  });

  /*
    Une manche ne gagne pas un match : `wins` se compte a la fin, une seule
    fois. Le compter par manche paierait trois fois le defi « gagner un duel »
    pour une seule partie.
  */
  it('ne compte jamais une victoire', () => {
    expect(roundContribution(outcome({ countered: true, perfect: true })).wins).toBe(0);
  });
});

describe('mergeContributions', () => {
  it('additionne ce qui se cumule', () => {
    const merged = mergeContributions(
      contribution({ counters: 1, perfects: 2, rechargePoints: 100 }),
      contribution({ counters: 2, perfects: 1, rechargePoints: 150 }),
    );
    expect(merged.counters).toBe(3);
    expect(merged.perfects).toBe(3);
    expect(merged.rechargePoints).toBe(250);
  });

  /*
    Le meilleur combo de deux manches est le MEILLEUR, pas la somme. C'est la
    meme regle qu'entre deux parties, et elle doit valoir ici aussi — sinon
    trois manches a cinq de combo vaudraient un combo de quinze.
  */
  it('garde le meilleur combo, jamais leur somme', () => {
    const merged = mergeContributions(
      contribution({ bestCombo: 5 }),
      contribution({ bestCombo: 9 }),
    );
    expect(merged.bestCombo).toBe(9);
  });

  it('est neutre avec une contribution vide', () => {
    const one = contribution({ counters: 2, bestCombo: 6, rechargePoints: 30 });
    expect(mergeContributions(one, emptyContribution())).toEqual(one);
    expect(mergeContributions(emptyContribution(), one)).toEqual(one);
  });
});
