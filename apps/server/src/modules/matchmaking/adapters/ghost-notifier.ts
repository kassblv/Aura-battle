import { parseServerMessage, type ServerMessage, type ServerMessageName } from '@aura/protocol';
import type { AppLog } from '../../../shared/log-port.js';
import type { GhostDirector } from '../application/ghost-director.js';
import { isGhostSeatId } from '../domain/ghost.js';
import type { QueueNotifier } from '../domain/ports.js';

/**
 * Aiguillage des messages vers un siege fantome (docs/05 § « Fantomes »).
 *
 * Le runtime envoie ses messages a un siege, pas a une socket : il n'a aucune
 * raison de savoir que l'un des deux est un rejeu. Ce decorateur intercepte ce
 * qui part vers un identifiant de siege fantome et le remet au
 * `GhostDirector` ; tout le reste passe tel quel au notifier reel.
 *
 * **Sans lui, le fantome serait muet.** `SocketNotifier` jette sans bruit les
 * messages adresses a qui n'a pas de session — c'est le bon comportement pour
 * un joueur deconnecte, et ce serait exactement le mauvais ici : le fantome
 * n'apprendrait jamais qu'une recharge a commence.
 *
 * Le message est **analyse par son propre schema** avant d'etre remis. Ce n'est
 * pas une precaution symbolique : c'est ce qui garantit que le fantome lit
 * exactement ce qu'un client lirait, et cela transforme un parametre generique
 * en union discriminee sans la moindre conversion forcee.
 */
export class GhostNotifier implements QueueNotifier {
  constructor(
    private readonly inner: QueueNotifier,
    private readonly director: GhostDirector,
    private readonly log: AppLog | null = null,
  ) {}

  send<N extends ServerMessageName>(playerId: string, name: N, payload: ServerMessage<N>): void {
    if (!isGhostSeatId(playerId)) {
      this.inner.send(playerId, name, payload);
      return;
    }

    const parsed = parseServerMessage(name, payload);
    if (!parsed.success) {
      // Un message sortant hors schema est un defaut du serveur, ici comme sur
      // le reseau. Le fantome jouera la manche par defaut plutot que de rien.
      this.log?.warn(`message « ${name} » invalide vers un fantome : ${parsed.error}`);
      return;
    }

    this.director.deliver(playerId, parsed.data);
  }
}
