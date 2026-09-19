import { Inject, Injectable } from '@nestjs/common';
import { serializeServerMessage, type ServerMessage, type ServerMessageName } from '@aura/protocol';
import type { Socket } from 'socket.io';
import { PinoLoggerService } from '../../../shared/logger.js';
import type { MatchNotifier } from '../domain/ports.js';

/**
 * Envoi des messages aux joueurs connectes.
 *
 * Tient le registre des sockets par joueur et **valide chaque message avant de
 * l'emettre**. C'est la moitie du garde-fou qu'on oublie : valider l'entrant
 * protege le serveur, valider le sortant protege les joueurs. Un message qui ne
 * passe pas son propre schema n'est pas envoye — c'est un defaut du serveur, et
 * il est journalise comme tel.
 */
@Injectable()
export class SocketNotifier implements MatchNotifier {
  private readonly sockets = new Map<string, Socket>();

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
  register(playerId: string, socket: Socket): void {
    const previous = this.sockets.get(playerId);
    this.sockets.set(playerId, socket);
    if (previous !== undefined && previous !== socket) {
      previous.disconnect(true);
    }
  }

  unregister(playerId: string, socket: Socket): void {
    // On ne retire que si c'est bien la socket courante : une reconnexion
    // rapide peut enregistrer la nouvelle avant que l'ancienne ne se ferme.
    if (this.sockets.get(playerId) === socket) {
      this.sockets.delete(playerId);
    }
  }

  isConnected(playerId: string): boolean {
    return this.sockets.has(playerId);
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
    this.sockets.get(playerId)?.emit(name, checked.data);
  }
}
