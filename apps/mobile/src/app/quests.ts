import type { ChallengeView } from '@aura/protocol';

/**
 * Ce qui vient d etre termine, entre deux etats venus du serveur.
 *
 * Aucune progression n est calculee ici : on compare deux photos que le
 * serveur a prises. C est ce qui permet de dire « defi termine » au moment ou
 * le joueur sort de son match, sans que le client ait a deviner quoi que ce
 * soit de ce qui s y est passe.
 */
export function newlyCompleted(
  before: readonly ChallengeView[],
  after: readonly ChallengeView[],
): readonly ChallengeView[] {
  const doneBefore = new Set(
    before.filter((challenge) => challenge.done).map((challenge) => challenge.id),
  );
  const known = new Set(before.map((challenge) => challenge.id));

  return after.filter(
    (challenge) =>
      challenge.done &&
      // Deja fini avant : on l a deja annonce. C est aussi ce qui empeche le
      // message de reparaitre a chaque recompense encaissee.
      !doneBefore.has(challenge.id) &&
      /*
        Et deja vu AVANT. Cette seule condition en couvre deux, et j'avais
        ecrit un garde-fou separe pour la seconde avant de constater qu'il ne
        servait a rien — le retirer ne faisait echouer aucun test :

        - au changement de jour les identifiants changent tous : un defi qui
          apparait deja termine n'a pas ete termine a l'instant, et l'annoncer
          ferait feter au joueur quelque chose qu'il n'a pas fait ;
        - au premier chargement il n'y a pas d'avant du tout, donc rien n'est
          « deja vu », donc rien ne s'annonce.
      */
      known.has(challenge.id),
  );
}
