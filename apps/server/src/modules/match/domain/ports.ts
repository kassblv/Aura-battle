import type { ServerMessage, ServerMessageName } from '@aura/protocol';

/**
 * Ports du module match (architecture hexagonale, docs/02).
 *
 * Le runtime ne connait ni Socket.IO ni `setTimeout` : il les recoit. C'est ce
 * qui permet de jouer un match entier dans un test, echeances comprises, sans
 * attendre les vingt-cinq secondes d'une manche reelle.
 */

/** Envoi d'un message a un joueur. */
export interface MatchNotifier {
  send<N extends ServerMessageName>(playerId: string, name: N, payload: ServerMessage<N>): void;
}

/** Programmation des echeances de phase. */
export interface TimerScheduler {
  /** Programme `run` pour l'instant donne, en remplacant toute echeance existante. */
  schedule(key: string, atMs: number, run: () => void): void;
  cancel(key: string): void;
}

/** Horloge, en millisecondes depuis l'epoque. */
export interface MatchClock {
  now(): number;
}
