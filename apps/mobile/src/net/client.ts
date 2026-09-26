import {
  parseServerMessage,
  serializeClientMessage,
  type ClientMessage,
  type ClientMessageName,
  type ServerMessage,
  type ServerMessageName,
} from '@aura/protocol';
import { createSyncedClock, type SyncedClock } from './clock.js';
import { createConnection, type Connection } from './connection.js';

/**
 * Le client de jeu, independant du transport.
 *
 * Socket.IO n apparait pas ici : ce module recoit un `Transport`, ce qui le
 * rend testable sans reseau et laisse la porte ouverte a un autre canal. Il
 * fait trois choses que l interface ne doit pas refaire — valider ce qui
 * arrive, valider ce qui part, et tenir l horloge et l etat du lien a jour.
 */

export interface Transport {
  send(name: string, payload: unknown): void;
  /** Le serveur parle : `{ name, payload }`, quel que soit le canal. */
  onMessage(handler: (message: unknown) => void): void;
  onConnect(handler: () => void): void;
  onDisconnect(handler: () => void): void;
  /**
   * Force une verification de la connexion.
   *
   * Appele au retour au premier plan : une WebView suspendue laisse derriere
   * elle une socket qui se croit ouverte, et le client ne l apprend qu au
   * prochain paquet — qui part dans le vide pendant que l ecran affiche
   * « en ligne ».
   */
  wake(): void;
  close(): void;
}

export interface GameClientOptions {
  /** Horloge locale, injectee pour les tests. */
  readonly now?: () => number;
}

type Listener<N extends ServerMessageName> = (data: ServerMessage<N>) => void;

export interface GameClient {
  readonly connection: Connection;
  readonly clock: SyncedClock;
  /** Heure locale du client, la meme que celle de `clock` : `performance.now()` par defaut. */
  readonly now: () => number;
  /** Messages jetes faute de forme ou de nom connu. */
  readonly droppedMessages: number;
  on<N extends ServerMessageName>(name: N, listener: Listener<N>): () => void;
  send<N extends ClientMessageName>(name: N, payload: ClientMessage<N>): boolean;
  ping(): void;
  /**
   * Le retour au premier plan.
   *
   * Ne fait rien si la connexion se sait deja perdue : la reconnexion de
   * Socket.IO tourne alors, et la brusquer relancerait son compte a rebours
   * depuis zero.
   */
  wake(): void;
  close(): void;
}

interface Envelope {
  readonly name: string;
  readonly payload: unknown;
}

const isEnvelope = (value: unknown): value is Envelope =>
  typeof value === 'object' && value !== null && typeof (value as Envelope).name === 'string';

export function createGameClient(
  transport: Transport,
  options: GameClientOptions = {},
): GameClient {
  const now = options.now ?? (() => performance.now());
  const connection = createConnection();
  const clock = createSyncedClock();
  const listeners = new Map<string, Set<(data: never) => void>>();

  /** Estampilles des `ping` en vol, pour n accepter que les vrais `pong`. */
  const pending = new Set<number>();
  let dropped = 0;

  connection.connecting();

  const send = <N extends ClientMessageName>(name: N, payload: ClientMessage<N>): boolean => {
    /**
     * On valide **avant** d emettre.
     *
     * C est la moitie du garde-fou qu on oublie : un message malforme serait
     * refuse par le serveur, et le client attendrait une reponse qui ne vient
     * jamais — une attente muette est bien pire qu un refus immediat.
     */
    const checked = serializeClientMessage(name, payload);
    if (!checked.success) return false;
    transport.send(name, checked.data);
    return true;
  };

  transport.onMessage((message) => {
    if (!isEnvelope(message)) {
      dropped += 1;
      return;
    }

    /**
     * Tout ce qui arrive passe par le schema.
     *
     * Un mandataire, une extension de navigateur ou un serveur d une version
     * plus recente peuvent poser n importe quoi sur ce canal. Un nom inconnu
     * n est d ailleurs pas une panne : c est une version d avance, et la
     * bonne reponse est de l ignorer.
     */
    const parsed = parseServerMessage(message.name, message.payload);
    if (!parsed.success) {
      dropped += 1;
      return;
    }

    const { name, data } = parsed.data;

    if (name === 'pong') {
      const pong = data;
      // Un `pong` qui ne repond a aucun `ping` ne mesure rien : l accepter
      // ferait entrer un decalage invente dans l horloge qui date les taps.
      if (pending.delete(pong.t)) {
        clock.observe({ sentAtMs: pong.t, serverTimeMs: pong.serverTime, receivedAtMs: now() });
      }
      return;
    }

    if (name === 'match:found' || name === 'match:state') {
      connection.joinedMatch(data.matchId);
    }
    if (name === 'match:end') {
      connection.leftMatch();
    }

    for (const listener of listeners.get(name) ?? []) {
      (listener as Listener<typeof name>)(data);
    }
  });

  transport.onConnect(() => {
    /**
     * Socket.IO se reconnecte de lui-meme : personne n annonce la tentative.
     * On marque donc la transition ici, sinon l ouverture arrive sur un lien
     * declare hors ligne — et la machine, qui refuse une ouverture non
     * demandee, la laisserait passer sans rien reprendre.
     */
    if (connection.status === 'offline') connection.connecting();
    connection.opened();
    const resume = connection.resumeAction();
    // Au retour on ne redemarre pas une partie : on demande l etat.
    if (resume !== null) send('match:rejoin', { matchId: resume.matchId });
  });

  transport.onDisconnect(() => {
    connection.lost();
    pending.clear();
  });

  return {
    connection,
    clock,
    now,

    get droppedMessages(): number {
      return dropped;
    },

    on(name, listener) {
      const set = listeners.get(name) ?? new Set();
      set.add(listener);
      listeners.set(name, set);
      return () => {
        set.delete(listener);
      };
    },

    send,

    ping() {
      const t = now();
      pending.add(t);
      send('ping', { t });
    },

    wake() {
      if (connection.status === 'offline') return;
      transport.wake();
    },

    close() {
      transport.close();
    },
  };
}
