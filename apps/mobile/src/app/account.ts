/**
 * Ce que l ecran Reglages dit du compte.
 *
 * Les textes vivent ici, pas dans le composant : ils portent des
 * avertissements dont l exactitude compte plus que la mise en page, et un test
 * peut alors verifier qu ils disent bien ce qu ils doivent dire.
 */

export type AccountMoment = 'idle' | 'issued' | 'claim';

/**
 * Decoupe un code en groupes lisibles.
 *
 * Les groupes ne sont pas une coquetterie : ils permettent de tenir sa place
 * en recopiant d un ecran vers un autre appareil, et de reprendre un groupe
 * plutot que tout le code quand on se perd.
 */
export function groupsOf(code: string): readonly string[] {
  return code.split('-');
}

const NOTICES: Readonly<Record<AccountMoment, string>> = Object.freeze({
  idle: 'Ton compte vit dans ce navigateur. Un code te permet de le retrouver ailleurs.',
  /*
    Deux faits, et le joueur doit repartir en connaissant les deux : le serveur
    ne garde que l empreinte du code, donc personne ne pourra le lui réafficher ;
    et en redemander un annule le precedent, ce qui est la seule façon de
    revoquer un code qui aurait traîné.
  */
  issued:
    'Note ce code maintenant : il ne sera plus jamais réaffiché. En demander un nouveau annule l’ancien.',
  /*
    L avertissement le plus important de l ecran, et il doit etre lu AVANT le
    geste. Quelqu un qui vient de jouer trente minutes en invite sur cet
    ordinateur doit savoir que ces trente minutes partent.
  */
  claim:
    'Attention : la progression de ce navigateur sera abandonnée et remplacée par celle du compte retrouvé.',
});

export function accountNotice(moment: AccountMoment): string {
  return NOTICES[moment];
}
