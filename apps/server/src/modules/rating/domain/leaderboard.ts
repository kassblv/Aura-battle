/**
 * Le classement general (docs/05).
 *
 * La partie pure : assembler ce que la base a rendu en une vue que l'ecran
 * peut dessiner sans rien recalculer. Le tri et le rang viennent de Postgres,
 * qui porte l'index `(seasonId, leaguePoints)` fait pour ca.
 */

/** Combien de places on montre en tete. */
export const LEADERBOARD_TOP = 50;

/**
 * Combien de voisins de part et d'autre du joueur.
 *
 * Montrer seulement la tete ne dit rien a quatre-vingt-dix-neuf joueurs sur
 * cent : la question qu'on se pose devant un classement est « ou suis-je »,
 * pas « qui est premier ». Deux voisins suffisent a situer — au-dela, on
 * remplit l'ecran sans rien apprendre de plus.
 */
export const NEIGHBOURS = 2;

export interface RankedRow {
  readonly rank: number;
  readonly playerId: string;
  readonly displayName: string;
  readonly leaguePoints: number;
  readonly league: string;
  readonly wins: number;
  readonly losses: number;
}

/** Une ligne telle que l'ecran la lit : elle sait si c'est la sienne. */
export interface LeaderboardRow extends RankedRow {
  readonly isMe: boolean;
}

export interface LeaderboardView {
  readonly top: readonly LeaderboardRow[];
  /**
   * Le voisinage du joueur, **vide** s'il est deja dans la tete.
   *
   * Ce n'est pas sa propre ligne qu'on evite de repeter — l'ecran la montre
   * sous « ta place » quoi qu'il arrive, et c'est utile : on repond a « ou
   * suis-je » sans faire defiler cinquante lignes. Ce qu'on evite, ce sont ses
   * VOISINS, deja visibles a deux lignes de la sienne dans la tete. Les
   * afficher une seconde fois remplirait la colonne de droite d'un extrait de
   * celle de gauche.
   */
  readonly around: readonly LeaderboardRow[];
  /** `null` pour qui n'a jamais fini de match classe. Ce n'est pas une anomalie. */
  readonly me: LeaderboardRow | null;
}

export interface LeaderboardInput {
  readonly top: readonly RankedRow[];
  readonly around: readonly RankedRow[];
  readonly me: RankedRow | null;
}

export function leaderboardView(input: LeaderboardInput): LeaderboardView {
  const mark = (row: RankedRow): LeaderboardRow => ({
    ...row,
    isMe: input.me !== null && row.playerId === input.me.playerId,
  });

  const top = input.top.slice(0, LEADERBOARD_TOP).map(mark);
  const inTop = input.me !== null && top.some((row) => row.playerId === input.me?.playerId);

  return {
    top,
    around: inTop ? [] : input.around.map(mark),
    me: input.me === null ? null : mark(input.me),
  };
}
