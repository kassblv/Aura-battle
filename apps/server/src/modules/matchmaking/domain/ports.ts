import type { ServerMessage, ServerMessageName } from '@aura/protocol';
import type { GhostRecording, GhostRound } from './ghost.js';
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
  /**
   * Retire **un** ticket, et dit s'il etait encore la.
   *
   * Pendant a un siege de `claimPair` : la bascule vers un fantome ne marie
   * pas deux joueurs, elle en sort un seul de la file pour l'asseoir face a un
   * enregistrement. `remove` ne suffit pas — il ne dit rien — et deux tours qui
   * se chevauchent ouvriraient alors deux matchs pour la meme personne.
   */
  claim(playerId: string): Promise<boolean>;
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
 *
 * **`null` oblige l'appelant a remettre les tickets en file.** Ils en sont
 * sortis avant l'appel — `tick` les a reclames, sans quoi le tour suivant
 * rapparierait les memes joueurs — et l'ouverture ne peut pas les y reposer :
 * elle ne les a jamais eus, et elle n'a pas le droit d'attendre. Un refus non
 * compense laisse deux joueurs hors de la file et sans match, devant un ecran
 * de recherche que plus rien n'alimente.
 *
 * **Synchrone, et c'est une contrainte, pas une commodite** : une attente entre
 * le controle des sieges et leur reservation suffit a asseoir un joueur a deux
 * matchs. Le port l'impose donc a toute realisation future.
 */
export interface MatchOpening {
  open(request: {
    playerA: string;
    playerB: string;
    mode: 'RANKED' | 'CASUAL';
    /**
     * Siege tenu par un fantome (docs/05). Absent, les deux sieges sont des
     * personnes — c'est le cas de tout appariement humain.
     */
    ghost?: {
      seat: 'a' | 'b';
      sourcePlayerId: string;
      mmr: number;
      recordingId: string;
      displayName: string;
      league: string;
    };
    /**
     * Attente en file de chaque siege humain (indicateurs produit, docs/00).
     * Un siege absent n'a pas fait la queue : fantome, ou invitation.
     */
    queueWaitMs?: Partial<Record<'a' | 'b', number>>;
  }): string | null;
}

export const MATCH_OPENING = 'MATCH_OPENING';

/**
 * Etat d'un joueur vu du serveur, **en deux questions separees**.
 *
 * Un seul booleen « disponible » ne suffit pas, et c'est un piege qui a coute
 * trois defauts : « parti » et « deja en duel » appellent des traitements
 * **opposes**. Le joueur parti garde sa place au chaud le temps de revenir
 * (`docs/03` lui accorde 45 s) ; le joueur assis a un duel, lui, n'a plus rien
 * a faire en file et son ticket doit disparaitre. Confondre les deux, c'est
 * soit detruire la place de quelqu'un qui revient, soit remettre a chercher un
 * adversaire quelqu'un qui est en train de jouer.
 *
 * Les deux reponses sont synchrones : elles viennent du registre des sockets
 * et de l'index des matchs en cours, tous deux locaux au processus.
 */
export interface PlayerAvailability {
  /** Toujours au bout d'une socket ? */
  isConnected(playerId: string): boolean;
  /** Deja assis a un duel ? */
  isBusy(playerId: string): boolean;
}

/** Horloge du worker. Le temps entre par la, et nulle part ailleurs. */
export interface QueueClock {
  now(): number;
}

/**
 * Rangement des enregistrements de fantomes (docs/05 § « Fantomes »).
 *
 * Volontairement etroit : on ecrit un enregistrement a la fin d'un match, on
 * relit des candidats pour un ticket. Le **choix**, lui, n'est pas ici — il est
 * pur et vit dans `domain/ghost.ts`.
 */
export interface GhostRecordingStore {
  /**
   * Enregistrements utilisables pour ce niveau, a cette version des regles.
   *
   * La fourchette est une **presomption**, pas la decision : le selecteur
   * refiltre ce qui revient. Elle existe pour ne pas rapatrier la table
   * entiere, et c'est tout ce qu'on lui demande.
   */
  candidates(query: {
    readonly rulesVersion: string;
    readonly mmr: number;
    readonly range: number;
    readonly limit: number;
  }): Promise<readonly GhostRecording[]>;

  /**
   * Ecrit l'enregistrement d'un joueur, en **remplacant** le precedent.
   *
   * Un enregistrement par joueur, pas un par match : sans ce remplacement la
   * table grossirait d'une ligne a chaque manche classee jouee sur le serveur,
   * pour un besoin — « offrir un adversaire credible de ce niveau » — qu'une
   * seule ligne par joueur remplit deja. La plus recente est aussi celle dont
   * le MMR est le plus juste.
   */
  save(recording: {
    readonly playerId: string;
    readonly mmr: number;
    readonly rulesVersion: string;
    readonly rounds: readonly GhostRound[];
    readonly atMs: number;
  }): Promise<void>;
}

export const GHOST_RECORDING_STORE = 'GHOST_RECORDING_STORE';
