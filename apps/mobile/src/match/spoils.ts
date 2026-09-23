import { levelFor } from '@aura/rules';

/**
 * Ce qu une partie a rapporte, tel que l ecran de fin doit le dire.
 *
 * Le serveur calcule tout et l envoie dans `match:end` : les pieces, le
 * classement avant et apres, la ligue avant et apres. Le client ne recalcule
 * rien — il decide seulement ce qui MERITE d etre montre.
 *
 * Car tout montrer revient a ne rien montrer. « +0 ◈ » apprend au joueur que
 * cette ligne ne vaut pas la peine d etre lue, et le jour ou elle porte un
 * vrai chiffre il ne la lira plus.
 */

/** Ce que `match:end` apporte, reduit a ce dont l annonce a besoin. */
export interface MatchEndFacts {
  readonly softCurrency: number;
  /** Experience gagnee par ce match. */
  readonly xp: number;
  /** Experience TOTALE apres ce match : le niveau s en deduit. */
  readonly xpTotal: number;
  readonly ratingBefore: number;
  readonly ratingAfter: number;
  readonly leagueBefore: string;
  readonly leagueAfter: string;
}

export interface MatchSpoils {
  /** Pieces gagnees, ou `null` s il n y en a pas. */
  readonly coins: number | null;
  /** Ecart de classement, signe. `null` si le classement n a pas bouge. */
  readonly lp: number | null;
  /** Experience gagnee, ou `null` s il n y en a pas. */
  readonly xp: number | null;
  /**
   * Le niveau atteint, uniquement s il vient d etre franchi.
   *
   * Un palier est le moment le plus gros de cette progression-la : il se
   * nomme, il ne se deduit pas d une barre qui a l air pleine.
   */
  readonly levelUp: number | null;
  /** La nouvelle ligue, uniquement si elle a change. */
  readonly league: string | null;
  /** Vrai quand il n y a rien a annoncer : l appelant n affiche alors rien. */
  readonly empty: boolean;
}

export function matchSpoils(facts: MatchEndFacts): MatchSpoils {
  const coins = facts.softCurrency > 0 ? facts.softCurrency : null;

  const delta = facts.ratingAfter - facts.ratingBefore;
  const lp = delta === 0 ? null : delta;

  /*
    La ligue se nomme dans les DEUX sens.

    Ne montrer que les montees ferait disparaitre un joueur de sa ligue sans
    explication — et un silence a cet endroit-la se lit comme un bogue, pas
    comme une delicatesse.
  */
  const league = facts.leagueAfter === facts.leagueBefore ? null : facts.leagueAfter;

  const xp = facts.xp > 0 ? facts.xp : null;

  /*
    Le palier se lit en comparant AVANT et APRES, avec la meme courbe que le
    serveur. Le gain seul ne suffit pas : trente d'experience font franchir un
    niveau ou pas selon ou l'on etait.
  */
  const after = levelFor(facts.xpTotal);
  const before = levelFor(facts.xpTotal - facts.xp);
  const levelUp = after.level > before.level ? after.level : null;

  return {
    coins,
    lp,
    xp,
    levelUp,
    league,
    empty: coins === null && lp === null && xp === null && league === null,
  };
}
