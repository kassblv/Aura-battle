import type { ChallengeView } from '@aura/protocol';
import { describe, expect, it } from 'vitest';
import { newlyCompleted } from './quests.js';

const quest = (id: string, over: Partial<ChallengeView> = {}): ChallengeView => ({
  id,
  name: id,
  progress: 0,
  target: 3,
  reward: 50,
  done: false,
  claimed: false,
  ...over,
});

describe('newlyCompleted', () => {
  /*
    Le moment qui compte est celui ou le defi VIENT d etre fini. Le joueur
    sort du match, et c est la qu il faut le lui dire — pas au prochain
    passage par un ecran qu il n a aucune raison d ouvrir.
  */
  it('trouve ce qui vient de passer a termine', () => {
    const avant = [quest('a'), quest('b')];
    const apres = [quest('a', { done: true, progress: 3 }), quest('b')];
    expect(newlyCompleted(avant, apres).map((q) => q.id)).toEqual(['a']);
  });

  it('ignore ce qui etait deja termine', () => {
    const fini = quest('a', { done: true, progress: 3 });
    expect(newlyCompleted([fini], [fini])).toEqual([]);
  });

  it('ignore ce qui n est toujours pas termine', () => {
    expect(newlyCompleted([quest('a')], [quest('a', { progress: 2 })])).toEqual([]);
  });

  /*
    Le premier chargement n a rien AVANT. Comparer a une liste vide ferait
    surgir « defi termine ! » sur trois defis finis hier, au lancement du jeu,
    sans que le joueur ait rien fait.
  */
  it('ne dit rien quand il n y a pas d avant', () => {
    expect(newlyCompleted([], [quest('a', { done: true })])).toEqual([]);
  });

  /*
    Encaisser change la liste sans rien terminer. Sans cette garde, le message
    reparaitrait a chaque recompense prise — et il finirait par ne plus rien
    vouloir dire.
  */
  it('ne se declenche pas sur un encaissement', () => {
    const avant = [quest('a', { done: true, progress: 3 })];
    const apres = [quest('a', { done: true, progress: 3, claimed: true })];
    expect(newlyCompleted(avant, apres)).toEqual([]);
  });

  /*
    Minuit : la journee change, les identifiants aussi. Un defi du jour qu on
    n a jamais vu avant n a pas « ete termine a l instant » — il vient
    d apparaitre, et il est deja fini seulement si le joueur a joue avant de
    regarder, ce qui n est pas le cas au changement de jour.
  */
  it('ne dit rien d un defi qui vient d apparaitre', () => {
    const avant = [quest('hier', { done: true })];
    const apres = [quest('aujourdhui', { done: true })];
    expect(newlyCompleted(avant, apres)).toEqual([]);
  });

  it('rend plusieurs defis quand la partie en a fini plusieurs', () => {
    const avant = [quest('a'), quest('b'), quest('c')];
    const apres = [quest('a', { done: true }), quest('b', { done: true }), quest('c')];
    expect(newlyCompleted(avant, apres).map((q) => q.id)).toEqual(['a', 'b']);
  });

  it('rend les defis eux-memes, pas seulement leurs identifiants', () => {
    const apres = quest('a', { done: true, progress: 3, reward: 85 });
    expect(newlyCompleted([quest('a')], [apres])).toEqual([apres]);
  });
});
