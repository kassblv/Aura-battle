/**
 * Ce que le joueur a fait, compte a partir de ce que le serveur a confirme.
 *
 * Aucun de ces chiffres n'est invente : chacun vient d'un `match:end`, donc
 * d'une partie reellement achevee et reglee par le serveur. C'est la
 * difference avec le profil de depart, ou tout etait a zero **parce qu'il n'y
 * avait rien a compter** — montrer des chiffres qu'on n'a pas gagnes apprend
 * au joueur a ne pas croire ce que l'ecran affiche.
 *
 * Provisoire, comme le reste du rangement local : la base tient deja `wins`,
 * `losses` et `placements` dans `Rating`, et le serveur reprendra la main.
 */

export interface PlayerRecord {
  readonly matches: number;
  readonly wins: number;
  readonly currentStreak: number;
  readonly bestStreak: number;
  /** Points de ligue, tels que le serveur les a annonces. */
  readonly lp: number;
}

export interface MatchOutcome {
  /** `null` pour une egalite : personne n'a gagne, personne n'a perdu. */
  readonly won: boolean | null;
  readonly lp: number;
}

export function emptyRecord(): PlayerRecord {
  return { matches: 0, wins: 0, currentStreak: 0, bestStreak: 0, lp: 0 };
}

export function recordMatch(record: PlayerRecord, outcome: MatchOutcome): PlayerRecord {
  const won = outcome.won === true;
  /**
   * Une egalite laisse la serie intacte : il n'y a pas de vainqueur, et la
   * traiter comme une defaite punirait le joueur pour ce qu'il n'a pas perdu.
   */
  const streak = won ? record.currentStreak + 1 : outcome.won === null ? record.currentStreak : 0;

  return {
    matches: record.matches + 1,
    wins: record.wins + (won ? 1 : 0),
    currentStreak: streak,
    // La meilleure serie est un souvenir : une defaite ne l'efface pas.
    bestStreak: Math.max(record.bestStreak, streak),
    /**
     * Les LP sont RECOPIES, jamais additionnes.
     *
     * Le serveur fait autorite. Cumuler un delta deriverait a la premiere
     * annonce manquee — une coupure reseau, un rechargement — et le profil
     * finirait par afficher un classement que la base ne confirme pas.
     */
    lp: Math.max(0, outcome.lp),
  };
}
