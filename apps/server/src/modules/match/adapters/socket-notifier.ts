import { Inject, Injectable } from '@nestjs/common';
import { serializeServerMessage, type ServerMessage, type ServerMessageName } from '@aura/protocol';
import type { Socket } from 'socket.io';
import { PinoLoggerService } from '../../../shared/logger.js';
import { UNKNOWN_PLAYER_NAME } from '../domain/directory.js';
import type { MatchNotifier } from '../domain/ports.js';

/**
 * Registre des sessions connectees, et envoi des messages.
 *
 * Il tient trois choses par joueur : sa socket, son nom affiche, et la garantie
 * que **chaque message est valide avant d'etre emis**. C'est la moitie du
 * garde-fou qu'on oublie : valider l'entrant protege le serveur, valider le
 * sortant protege les joueurs. Un message qui ne passe pas son propre schema
 * n'est pas envoye — c'est un defaut du serveur, et il est journalise comme tel.
 *
 * **Pourquoi le nom vit ici.** C'est une propriete de la session, pas du match :
 * le resoudre a la connexion — ou l'on attend deja l'authentification — permet a
 * l'ouverture d'un match de rester **entierement synchrone**. Sans cela, il
 * faudrait lire la base entre le controle des sieges et leur reservation, et
 * cette attente suffit a laisser deux messages de la meme salve asseoir un
 * joueur a deux matchs.
 */

/** Une session connectee : sa socket et ce qu'on affichera d'elle. */
interface Session {
  readonly socket: Socket;
  readonly displayName: string;
}

@Injectable()
export class SocketNotifier implements MatchNotifier {
  private readonly sessions = new Map<string, Session>();

  constructor(@Inject(PinoLoggerService) private readonly logger: PinoLoggerService) {}

  /**
   * Enregistre la socket d'un joueur et **ferme la precedente**.
   *
   * Sans cette fermeture, l'ancienne socket reste authentifiee et pleinement
   * operante : elle ne recoit plus rien, mais elle peut toujours emettre. Un
   * joueur ouvrant cent sockets avec un seul jeton disposerait alors de cent
   * fois le budget de debit, chacune ayant son propre seau a jetons. `docs/03`
   * prevoit de toute facon que le client ferme proprement avant de se
   * reconnecter.
   */
  register(playerId: string, socket: Socket, displayName: string): void {
    const previous = this.sessions.get(playerId);
    this.sessions.set(playerId, { socket, displayName });
    if (previous !== undefined && previous.socket !== socket) {
      previous.socket.disconnect(true);
    }
  }

  /**
   * Retire une socket, et **dit si c'etait bien la socket courante**.
   *
   * Ce booleen n'est pas un detail de confort : `register` ferme la socket
   * precedente, et Socket.IO emet `disconnect` synchroniquement dans la meme
   * pile. L'ancien handler se declenche donc **pendant** une reconnexion
   * parfaitement legitime. Si l'appelant en tire un abandon ou une sortie de
   * file, chaque reconnexion punit le joueur qui revient. Repondre `false` ici
   * est ce qui permet a l'appelant de faire la difference, au lieu de dependre
   * de l'ordre de deux lignes.
   */
  unregister(playerId: string, socket: Socket): boolean {
    if (this.sessions.get(playerId)?.socket !== socket) return false;
    this.sessions.delete(playerId);
    return true;
  }

  isConnected(playerId: string): boolean {
    return this.sessions.has(playerId);
  }

  /**
   * Nom affiche d'un joueur connecte, resolu a sa connexion.
   *
   * Synchrone par construction : c'est ce qui permet d'annoncer un match sans
   * la moindre attente. Un joueur inconnu — deconnecte entre-temps — retombe
   * sur `UNKNOWN_PLAYER_NAME` plutot que de faire echouer l'ouverture : un nom
   * manquant ne vaut pas un duel annule.
   */
  displayNameOf(playerId: string): string {
    return this.sessions.get(playerId)?.displayName ?? UNKNOWN_PLAYER_NAME;
  }

  send<N extends ServerMessageName>(playerId: string, name: N, payload: ServerMessage<N>): void {
    const checked = serializeServerMessage(name, payload);
    if (!checked.success) {
      this.logger.error(
        new Error(`message sortant « ${name} » invalide : ${checked.error}`),
        undefined,
        'SocketNotifier',
      );
      return;
    }

    // Un joueur deconnecte n'est pas une erreur : le match continue sans lui,
    // les actions par defaut s'appliquent, et il reprendra sur `match:rejoin`.
    this.sessions.get(playerId)?.socket.emit(name, checked.data);
  }
}
