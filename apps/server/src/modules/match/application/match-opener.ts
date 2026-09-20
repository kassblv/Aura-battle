import { randomUUID } from 'node:crypto';
import { CONTENT_VERSION } from '@aura/content';
import { PROTOCOL_VERSION } from '@aura/protocol';
import { RULES_VERSION, type Seat } from '@aura/rules';
import type { AppLog } from '../../../shared/log-port.js';
import { UNKNOWN_PLAYER_NAME, type PlayerDirectory } from '../domain/directory.js';
import type { MatchNotifier } from '../domain/ports.js';
import type { MatchSeats } from './match-runtime.js';

/**
 * Ouverture d'un match, **chemin unique** (docs/03-pvp-protocol.md).
 *
 * Invitation et file d'attente passent par ici, et c'est tout l'interet : deux
 * chemins d'ouverture separes divergent toujours — l'un finit par annoncer le
 * bon nom d'adversaire, l'autre non, l'un verifie que les sieges sont libres,
 * l'autre l'oublie. Ajouter demain la revanche ou le fantome, c'est appeler
 * cette methode, pas la recopier.
 */

/** Ce que l'ouverture attend du runtime : asseoir deux joueurs, ou refuser. */
export interface MatchStarter {
  /** Vrai si ce joueur occupe deja un siege. */
  isBusy(playerId: string): boolean;
  /** Faux si le match existe deja ou si un siege est occupe. */
  createMatch(input: {
    matchId: string;
    seed: string;
    seats: MatchSeats;
    mode?: MatchMode;
  }): boolean;
  /** Arme le compte a rebours d'abandon d'un joueur absent. */
  notePlayerDisconnected(playerId: string): void;
}

/** Qui est encore au bout d'une socket. */
export interface PlayerPresence {
  isConnected(playerId: string): boolean;
}

/**
 * Sortie de file d'attente.
 *
 * Un joueur qui commence un match ne doit plus figurer dans la file, quel que
 * soit le chemin par lequel le match est arrive : sinon le worker l'apparie
 * une seconde fois, et son nouvel adversaire heritera d'un forfait.
 */
export interface QueueEviction {
  leave(playerId: string): Promise<void>;
}

export type MatchMode = 'RANKED' | 'CASUAL' | 'INVITE';

export interface OpenRequest {
  /** Siege `a`. Par convention, l'hote de l'invitation ou le plus ancien en file. */
  readonly playerA: string;
  readonly playerB: string;
  readonly mode: MatchMode;
}

export class MatchOpener {
  constructor(
    private readonly runtime: MatchStarter,
    private readonly notifier: MatchNotifier,
    private readonly presence: PlayerPresence,
    private readonly directory: PlayerDirectory,
    private readonly queue: QueueEviction | null = null,
    private readonly log: AppLog | null = null,
  ) {}

  /**
   * Ouvre le match, ou rend `null` si un siege n'est pas libre.
   *
   * L'ordre n'est pas negociable, et deux contraintes le fixent entierement.
   *
   * `createMatch` annonce la premiere manche **synchroniquement** : `round:intro`
   * part dans la foulee. `match:found` doit donc etre envoye avant, faute de
   * quoi le client recoit une manche portant un `matchId` qu'il ne connait pas
   * encore, avec un compte a rebours qui tourne pendant qu'il l'ignore.
   *
   * Mais annoncer un match qu'on ne pourra pas ouvrir serait pire : le client
   * basculerait sur une arene dont le serveur ne sait rien. D'ou le controle
   * des sieges juste avant l'annonce — et surtout **aucune attente** entre ce
   * controle, l'annonce et l'ouverture. Une seule lecture en base glissee la
   * suffit a laisser deux `invite:join` de la meme salve s'entrelacer et a
   * asseoir un joueur a deux matchs. Tout ce qui attend — sortie de file,
   * lecture des noms — se fait donc avant.
   */
  async open(request: OpenRequest): Promise<string | null> {
    const seats: MatchSeats = { a: request.playerA, b: request.playerB };

    await this.evict(seats.a);
    await this.evict(seats.b);

    /**
     * Le nom de l'adversaire est lu **avant** d'ouvrir le match.
     *
     * Il a ete code en dur : les deux joueurs voyaient « Adversaire », et le
     * bandeau de match ne designait donc personne. Une lecture ratee retombe
     * sur ce meme mot plutot que de faire echouer l'ouverture — un nom manquant
     * ne vaut pas un duel annule.
     */
    const names = await this.namesOf([seats.a, seats.b]);

    // A partir d'ici, plus aucune attente : le controle, l'annonce et
    // l'ouverture forment un seul bloc que rien ne peut entrelacer.
    if (this.runtime.isBusy(seats.a) || this.runtime.isBusy(seats.b)) return null;

    const matchId = `m_${randomUUID()}`;
    const seed = randomUUID();

    for (const seat of ['a', 'b'] as const satisfies readonly Seat[]) {
      const playerId = seats[seat];
      const opponentId = seat === 'a' ? seats.b : seats.a;
      this.notifier.send(playerId, 'match:found', {
        matchId,
        seat,
        opponent: {
          displayName: names.get(opponentId) ?? UNKNOWN_PLAYER_NAME,
          league: 'bronze',
          cosmetics: {},
        },
        protocolVersion: PROTOCOL_VERSION,
        rulesVersion: RULES_VERSION,
        contentVersion: CONTENT_VERSION,
        ghost: false,
      });
    }

    if (!this.runtime.createMatch({ matchId, seed, seats, mode: request.mode })) {
      // Inatteignable sans collision d'identifiant : les sieges viennent
      // d'etre verifies sans attente entre-temps. Si cela arrivait, c'est un
      // defaut du serveur et il doit se voir.
      this.log?.warn(`ouverture refusee pour ${matchId} apres annonce aux joueurs`);
      return null;
    }

    /**
     * Un siege deja vide a l'arrivee.
     *
     * Un joueur a pu fermer sa socket pendant la sortie de file ou la lecture
     * des noms. Si son `disconnect` est passe avant l'existence du match, plus
     * rien n'armerait l'abandon : son adversaire subirait trois manches
     * d'actions par defaut au lieu d'un forfait en quarante-cinq secondes.
     */
    for (const playerId of [seats.a, seats.b]) {
      if (!this.presence.isConnected(playerId)) {
        this.runtime.notePlayerDisconnected(playerId);
      }
    }

    return matchId;
  }

  /** Sortie de file, au mieux : une file muette n'empeche pas de jouer. */
  private async evict(playerId: string): Promise<void> {
    try {
      await this.queue?.leave(playerId);
    } catch (cause) {
      this.log?.warn(`sortie de file impossible pour ${playerId} : ${String(cause)}`);
    }
  }

  /** Les noms, ou une carte vide si l'annuaire ne repond pas. */
  private async namesOf(playerIds: readonly string[]): Promise<ReadonlyMap<string, string>> {
    try {
      return await this.directory.displayNames(playerIds);
    } catch (cause) {
      this.log?.warn(`annuaire indisponible a l'ouverture du match : ${String(cause)}`);
      return new Map();
    }
  }
}
