import type { RankedRow } from './leaderboard.js';
import type { RatingSnapshot } from './rating.js';

/**
 * Ports du module rating (architecture hexagonale, docs/02 ; jalon M5).
 *
 * Le calcul (`rating.ts`) ne sait ni lire ni ecrire Postgres. Ces contrats
 * disent ce dont l'application a besoin de la base, rien de plus — la meme
 * discipline que `matchmaking/domain/ports.ts` pour `RatingReader`, dont ce
 * module prend le relais pour tout ce qui touche a l'ECRITURE du classement
 * (ADR 0010) : la lecture seule utilisee par l'appariement reste ou elle est,
 * elle n'a pas besoin d'en savoir plus qu'un MMR.
 */

/** Classement lu pour une saison, a un instant donne. */
export interface SeasonRatings {
  readonly seasonId: string;
  /** Un joueur absent n'a pas encore de ligne : `STARTING_RATING` s'applique. */
  readonly ratings: ReadonlyMap<string, RatingSnapshot>;
}

/**
 * Lecture du classement complet (pas seulement le MMR) de plusieurs joueurs.
 *
 * `null` hors saison : aucune saison n'encadre l'instant recu, et aucune
 * ecriture n'a de sens dans ce cas — un match peut tout de meme se jouer, il
 * ne changera simplement le classement de personne.
 */
export interface RatingLookup {
  loadForMatch(playerIds: readonly string[], nowMs: number): Promise<SeasonRatings | null>;
}

export const RATING_LOOKUP = 'RATING_LOOKUP';

/** Ecriture du classement d'une saison, pour un ou plusieurs joueurs a la fois. */
export interface RatingWriter {
  saveMany(
    seasonId: string,
    entries: readonly { readonly playerId: string; readonly rating: RatingSnapshot }[],
  ): Promise<void>;
}

export const RATING_WRITER = 'RATING_WRITER';

/**
 * Ligue affichee d'un joueur, pour l'annoncer a son adversaire.
 *
 * Sert exactement ce que `PlayerDirectory` sert pour le nom : une donnee
 * lue a la connexion, pour que l'ouverture d'un match reste synchrone
 * (`match/adapters/socket-notifier.ts`). `PlayerDirectory` refuse
 * volontairement de connaitre le classement (docs/02) ; ce port existe donc a
 * part, cote du module qui possede la donnee.
 */
export interface RatingDirectory {
  leaguesOf(playerIds: readonly string[], nowMs: number): Promise<ReadonlyMap<string, string>>;
}

export const RATING_DIRECTORY = 'RATING_DIRECTORY';

/**
 * Lecture du classement general (docs/05).
 *
 * Le tri et le rang viennent de la base, jamais d'un calcul en memoire :
 * `Rating` porte l'index `(seasonId, leaguePoints)` fait exactement pour ca,
 * et charger tous les classements pour les trier ici cesserait de tenir au
 * premier millier de joueurs.
 */
export interface LeaderboardReader {
  /** Les `limit` premiers de la saison en cours. */
  top(limit: number, nowMs: number): Promise<readonly RankedRow[]>;
  /**
   * Le joueur et ses voisins, ou `null` s'il n'a jamais fini de match classe.
   *
   * Un joueur sans ligne de classement n'est pas une anomalie : c'est le cas
   * de tous ceux qui viennent d'arriver.
   */
  around(
    playerId: string,
    neighbours: number,
    nowMs: number,
  ): Promise<{
    readonly me: RankedRow;
    readonly rows: readonly RankedRow[];
  } | null>;
}

export const LEADERBOARD_READER = 'LEADERBOARD_READER';

/**
 * Rafraichit la ligue mise en cache pour un joueur connecte.
 *
 * Realise par `SocketNotifier` (docs/03) : la ligue lue a la connexion se
 * perimerait autrement a chaque match classe joue dans la meme session, et
 * `match:found` finirait par annoncer une ligue vieille de vingt manches.
 * Synchrone, comme tout ce que `PlayerPresence` expose : l'ouverture d'un
 * match ne doit jamais attendre.
 */
export interface PresenceLeagueCache {
  setLeague(playerId: string, league: string): void;
}

export const PRESENCE_LEAGUE_CACHE = 'PRESENCE_LEAGUE_CACHE';

/**
 * Le credit de la monnaie douce a la fin d'un match.
 *
 * Le serveur ANNONCE une recompense depuis M5 ; il ne l'ecrivait nulle part.
 * C'est le client qui s'ajoutait l'argent dans son propre stockage — donc une
 * monnaie qu'on s'offrait soi-meme, perdue en changeant d'appareil. Avec un
 * inventaire cote serveur, la bourse doit vivre au meme endroit que ce qu'elle
 * achete.
 */
export interface WalletCredit {
  credit(
    entries: readonly {
      readonly playerId: string;
      readonly soft: number;
      /**
       * Experience gagnee par ce match.
       *
       * Creditee avec la monnaie, et dans la meme transaction : les deux
       * recompensent le meme match, et n'en accorder qu'une laisserait un
       * joueur paye sans avoir progresse — ou l'inverse, sans que rien ne
       * puisse le dire ensuite.
       */
      readonly xp: number;
    }[],
    /**
     * La saison du match, lue par le classement ; `null` hors saison.
     *
     * L'experience du match s'ajoute aussi a l'XP de SAISON (le passe), dans
     * la meme transaction. La saison vient de l'appelant plutot que d'une
     * relecture ici : celle qui a classe le match est celle qui le recompense.
     */
    seasonId: string | null,
    /*
      Rend l'experience TOTALE apres credit, par joueur.

      Le total ne se deduit pas d'un increment : il faut le relire, et la
      transaction qui ecrit est le seul endroit ou il est juste. Le calculer
      ailleurs — lecture avant, addition apres — donnerait un total faux des
      que deux matchs du meme joueur s'achevent ensemble, ce qui arrive avec
      deux onglets.
    */
  ): Promise<ReadonlyMap<string, number>>;
}
