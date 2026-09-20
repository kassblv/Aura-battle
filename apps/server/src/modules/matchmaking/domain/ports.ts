import type { ServerMessage, ServerMessageName } from '@aura/protocol';
import type { QueueTicket } from './ticket.js';

/**
 * Ports du module matchmaking (architecture hexagonale, docs/02).
 *
 * La file vit dans Redis, le classement dans Postgres, les joueurs au bout
 * d'une socket : rien de tout cela n'apparait dans la decision d'appariement.
 * Le service recoit ces quatre contrats, et les tests leur substituent des
 * doubles en memoire.
 *
 * Chaque port exporte son **jeton d'injection** juste a cote : une interface
 * TypeScript disparait a la compilation, Nest ne peut pas s'en servir comme
 * cle. Le jeton vit donc ici, une fois, plutot qu'en chaine recopiee dans
 * chaque module et chaque test.
 */

/**
 * Rangement des tickets en attente.
 *
 * `add` **remplace** : un joueur ne possede jamais deux tickets, quel que soit
 * le nombre de `queue:join` qu'il envoie. Le protocole borne un message, pas la
 * somme des messages — c'est ici que la somme est bornee.
 */
export interface QueueTicketStore {
  add(ticket: QueueTicket): Promise<void>;
  get(playerId: string): Promise<QueueTicket | null>;
  remove(playerId: string): Promise<void>;
  /** Tickets en attente, du plus ancien au plus recent. */
  listWaiting(): Promise<readonly QueueTicket[]>;
  /**
   * Retire deux tickets **d'un seul geste**, ou aucun.
   *
   * Sans atomicite, deux workers (ou deux tours qui se chevauchent) peuvent
   * asseoir le meme joueur a deux matchs, ou retirer un joueur de la file sans
   * lui ouvrir de match — il attendrait alors devant un ecran de recherche que
   * plus rien n'alimente.
   */
  claimPair(firstPlayerId: string, secondPlayerId: string): Promise<boolean>;
}

export const QUEUE_TICKET_STORE = 'QUEUE_TICKET_STORE';

/**
 * Memoire des rencontres recentes.
 *
 * docs/05 : « eviter de rematcher le meme adversaire deux fois de suite dans
 * les 10 minutes quand c'est possible ». L'instant est un parametre, ici comme
 * partout ailleurs : une fenetre de dix minutes qui se recalerait a chaque
 * ecriture finirait par retenir une heure de rencontres.
 */
export interface RecentOpponentStore {
  /** Adversaires rencontres dans la fenetre recente, a cet instant. */
  of(playerId: string, nowMs: number): Promise<readonly string[]>;
  record(firstPlayerId: string, secondPlayerId: string, nowMs: number): Promise<void>;
}

/** Duree pendant laquelle une rencontre reste « recente » (docs/05). */
export const RECENT_OPPONENT_WINDOW_MS = 10 * 60 * 1_000;

/**
 * Nombre d'adversaires recents transportes dans un ticket.
 *
 * Le ticket est ecrit puis relu a chaque tour d'appariement : une liste sans
 * borne le ferait grossir a proportion du nombre de matchs joues dans la
 * fenetre. Les plus recents suffisent a eviter une revanche immediate.
 */
export const MAX_RECENT_OPPONENTS = 16;

export const RECENT_OPPONENT_STORE = 'RECENT_OPPONENT_STORE';

/**
 * Lecture du classement cache.
 *
 * **Lecture seule, et volontairement.** Calculer un MMR est une autre ligne du
 * jalon M5 ; l'appariement se contente de lire ce que la base contient deja, et
 * retombe sur une valeur de depart constante pour un joueur sans classement.
 */
export interface RatingReader {
  /**
   * MMR des joueurs demandes, pour la saison en cours **a cet instant**.
   *
   * Un joueur absent de la reponse n'a pas de classement : ce n'est pas une
   * erreur, c'est le cas de tout nouveau venu.
   */
  mmrOf(playerIds: readonly string[], nowMs: number): Promise<ReadonlyMap<string, number>>;
}

export const RATING_READER = 'RATING_READER';

/**
 * Envoi d'un message a un joueur.
 *
 * Meme forme que le `MatchNotifier` du module match — le registre de sockets
 * est le meme objet — mais declare ici : le matchmaking ne doit pas avoir a
 * importer le module match pour savoir envoyer un `queue:status`.
 */
export interface QueueNotifier {
  send<N extends ServerMessageName>(playerId: string, name: N, payload: ServerMessage<N>): void;
}

export const QUEUE_NOTIFIER = 'QUEUE_NOTIFIER';

/**
 * Ouverture d'un match a partir d'une paire.
 *
 * Volontairement etroit : le matchmaking decide **qui** joue contre qui, et
 * delegue le reste. Ce port est realise par le chemin d'ouverture unique du
 * module match — celui qu'emprunte aussi l'invitation — pour que les deux
 * modes ne puissent pas diverger.
 *
 * Rend l'identifiant du match, ou `null` si un siege n'etait plus libre.
 */
export interface MatchOpening {
  open(request: {
    playerA: string;
    playerB: string;
    mode: 'RANKED' | 'CASUAL';
  }): Promise<string | null>;
}

export const MATCH_OPENING = 'MATCH_OPENING';

/** Horloge du worker. Le temps entre par la, et nulle part ailleurs. */
export interface QueueClock {
  now(): number;
}
