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

/** Une manche achevee, telle que le moteur l'a resolue. */
export interface PersistedRound {
  readonly round: number;
  /** `RoundResult` de @aura/rules, enregistre tel quel. */
  readonly result: unknown;
}

/**
 * Une entree du journal d'evenements.
 *
 * C'est ce qui rend un match **rejouable** : la graine plus la suite exacte
 * des evenements redonnent le meme match, octet pour octet. Sans ce journal,
 * un litige sur un resultat ne se tranche que sur parole.
 */
export interface PersistedEvent {
  /** Heure serveur de reception. */
  readonly atMs: number;
  readonly event: unknown;
}

export interface MatchRecord {
  readonly matchId: string;
  readonly seed: string;
  readonly mode: 'RANKED' | 'CASUAL' | 'INVITE' | 'SOLO';
  readonly rulesVersion: string;
  readonly contentVersion: string;
  readonly seats: Readonly<Record<'a' | 'b', string | null>>;
  readonly winner: 'a' | 'b' | null;
  readonly reason: string;
  readonly startedAtMs: number;
  readonly endedAtMs: number;
  readonly rounds: readonly PersistedRound[];
  /** Journal des evenements **acceptes**, borne. */
  readonly events: readonly PersistedEvent[];
  /**
   * Evenements refuses par le moteur.
   *
   * Comptes et non conserves : leur nombre interesse l'anti-triche, leur
   * contenu offrirait a un client bavard de quoi faire gonfler l'ecriture
   * jusqu'a la faire echouer.
   */
  readonly rejectedEvents: number;
  /** Entrees ecartees parce que le journal etait plein. */
  readonly droppedEvents: number;
}

/** Ecriture d'un match acheve. */
export interface MatchRepository {
  save(record: MatchRecord): Promise<void>;
}
