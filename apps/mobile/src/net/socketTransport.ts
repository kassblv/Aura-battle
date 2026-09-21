import { PROTOCOL_VERSION, SERVER_MESSAGE_NAMES } from '@aura/protocol';
import { io, type Socket } from 'socket.io-client';
import type { Transport } from './client.js';

/**
 * Le transport Socket.IO.
 *
 * Seul module du client reseau qui connaisse Socket.IO : tout ce qui se decide
 * — validation, horloge, reprise — vit dans `client.ts` et se teste sans
 * reseau. Ici on ne fait que brancher des fils.
 */

export interface SocketOptions {
  readonly url: string;
  readonly accessToken: string;
}

export function createSocketTransport(options: SocketOptions): Transport {
  const socket: Socket = io(options.url, {
    // Le serveur n'ecoute qu'en WebSocket : laisser le repli en long polling
    // ferait echouer une poignee de main sur deux sans expliquer pourquoi.
    transports: ['websocket'],
    auth: { token: options.accessToken, protocolVersion: PROTOCOL_VERSION },
    // La reconnexion est celle de Socket.IO ; `connection.ts` decide seulement
    // quoi redemander une fois revenu.
    reconnection: true,
    reconnectionDelay: 500,
    reconnectionDelayMax: 10_000,
  });

  return {
    send(name, payload) {
      socket.emit(name, payload);
    },

    onMessage(handler) {
      /**
       * On n ecoute que les noms du registre.
       *
       * `onAny` attraperait aussi les evenements internes de Socket.IO
       * (`connect`, `disconnect`, `connect_error`), qui ne sont pas des
       * messages de jeu et seraient comptes comme des rebuts a chaque
       * connexion.
       */
      for (const name of SERVER_MESSAGE_NAMES) {
        socket.on(name, (payload: unknown) => {
          handler({ name, payload });
        });
      }
    },

    onConnect(handler) {
      socket.on('connect', handler);
    },

    onDisconnect(handler) {
      socket.on('disconnect', handler);
    },

    /**
     * Au retour au premier plan : on ne CROIT pas l etat, on le verifie.
     *
     * iOS suspend la WebView, les battements de coeur cessent, le serveur
     * ferme de son cote — et `socket.connected` reste vrai jusqu au prochain
     * paquet perdu. Une deconnexion explicite suivie d une reconnexion remet
     * tout le monde d accord, et `connection.ts` redemande `match:rejoin`
     * comme apres n importe quelle coupure.
     */
    wake() {
      if (!socket.connected) return;
      socket.disconnect();
      socket.connect();
    },

    close() {
      socket.removeAllListeners();
      socket.disconnect();
    },
  };
}
