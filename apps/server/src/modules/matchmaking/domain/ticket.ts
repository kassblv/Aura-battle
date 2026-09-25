/**
 * Ticket de file d'attente (docs/05-matchmaking-ranking.md, § « File d'attente »).
 *
 * Un joueur qui cherche un adversaire est represente par un ticket, et un seul.
 * Tout ce dont l'appariement a besoin tient ici : rien n'oblige a relire la
 * base ou a interroger une socket pendant un tour d'appariement.
 */

/** Modes qui passent par la file. L'invitation et le solo n'y passent pas. */
export type QueueMode = 'ranked' | 'casual';

/**
 * Region de jeu.
 *
 * Le document prevoit une region par ticket, et l'appariement ne marie que des
 * tickets de meme region. Rien ne la renseigne encore — ni le modele de donnees
 * ni le protocole — donc tous les tickets portent `DEFAULT_REGION` aujourd'hui.
 * Le jour ou une region reelle arrivera, seule sa lecture changera : la regle
 * d'appariement, elle, est deja ecrite.
 */
export type Region = string;

export const DEFAULT_REGION: Region = 'global';

/**
 * MMR attribue a un joueur qui n'a pas encore de classement.
 *
 * `Rating.mmr` vaut 1000 par defaut dans le modele de donnees (docs/04) et le
 * document de classement compresse le MMR « vers 1000 » en fin de saison :
 * c'est donc le centre de l'echelle, et la seule valeur de depart qui ne cree
 * pas d'ecart artificiel avec les joueurs classes.
 *
 * Ce n'est **pas** un calcul de classement : lire un MMR absent ne fait pas de
 * ce module un juge du niveau des joueurs (jalon M5, autre ligne).
 */
export const DEFAULT_MMR = 1000;

/**
 * Temps passe en file par ce ticket a l'instant donne, en millisecondes
 * entieres, jamais negatif : une horloge qui recule ne cree pas d'attente
 * negative, qui fausserait la mediane des indicateurs produit.
 */
export function queueWaitOf(ticket: Pick<QueueTicket, 'enqueuedAtMs'>, nowMs: number): number {
  return Math.max(0, Math.floor(nowMs - ticket.enqueuedAtMs));
}

export interface QueueTicket {
  readonly playerId: string;
  readonly mode: QueueMode;
  /** Classement cache, lu au moment d'entrer en file. Ne sort jamais au client. */
  readonly mmr: number;
  /** Heure serveur d'entree en file. */
  readonly enqueuedAtMs: number;
  readonly region: Region;
  /**
   * Adversaires recents, a eviter si un autre appariement est possible.
   *
   * Lu **une fois**, a l'entree en file, et transporte dans le ticket : la
   * liste d'un joueur ne peut changer qu'en finissant un match, or on ne finit
   * pas de match en faisant la queue. Relire Redis pour chaque joueur a chaque
   * tour de worker couterait un aller-retour par joueur et par demi-seconde
   * pour une information qui, par construction, ne bouge pas.
   */
  readonly recentOpponents: readonly string[];
}
