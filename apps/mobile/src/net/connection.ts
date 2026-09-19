/**
 * L etat du lien avec le serveur.
 *
 * Une machine a etats pure : elle ne connaît ni Socket.IO ni le reseau. Elle
 * repond a deux questions que le transport ne sait pas trancher — combien de
 * temps attendre avant de retenter, et que demander une fois revenu.
 *
 * La seconde est celle que `CLAUDE.md` signale : une application mobile peut
 * etre suspendue en plein match. Au retour elle ne redemarre pas une partie,
 * elle demande l etat (`match:rejoin` puis `match:state`).
 */

/** Pas de base de l attente entre deux tentatives. */
export const BACKOFF_STEP_MS = 500;

/**
 * Plafond de l attente.
 *
 * Une coupure longue ne doit pas devenir un abandon : au-dela d une dizaine de
 * secondes, un joueur qui retrouve du reseau attendrait sans raison alors que
 * son match, lui, court toujours.
 */
export const BACKOFF_CEILING_MS = 10_000;

export type ConnectionStatus = 'offline' | 'connecting' | 'reconnecting' | 'online';

/** Ce qu il faut demander au serveur une fois le lien retabli. */
export interface ResumeAction {
  readonly type: 'rejoin';
  readonly matchId: string;
}

export interface ConnectionOptions {
  /** Injecte pour rendre la gigue reproductible dans les tests. */
  readonly random?: () => number;
}

export interface Connection {
  readonly status: ConnectionStatus;
  /** Match en cours, conserve a travers les coupures. */
  readonly matchId: string | null;
  /** Tentatives infructueuses depuis la derniere reussite. */
  readonly attempts: number;
  /** Attente avant la prochaine tentative, gigue comprise. */
  nextDelayMs(): number;
  connecting(): void;
  opened(): void;
  failed(): void;
  lost(): void;
  joinedMatch(matchId: string): void;
  leftMatch(): void;
  resumeAction(): ResumeAction | null;
}

export function createConnection(options: ConnectionOptions = {}): Connection {
  const random = options.random ?? Math.random;

  let status: ConnectionStatus = 'offline';
  let matchId: string | null = null;
  let attempts = 0;
  /** A-t-on deja ete en ligne ? Distingue une connexion d une reprise. */
  let everOnline = false;

  return {
    get status(): ConnectionStatus {
      return status;
    },
    get matchId(): string | null {
      return matchId;
    },
    get attempts(): number {
      return attempts;
    },

    nextDelayMs() {
      if (attempts === 0) return 0;
      const growth = Math.min(BACKOFF_CEILING_MS, BACKOFF_STEP_MS * 2 ** (attempts - 1));
      /**
       * Gigue : la moitie du delai est tiree au hasard.
       *
       * Sans elle, tous les clients coupes par la meme panne reviennent
       * exactement ensemble — ce qui transforme un incident reseau en coup de
       * belier sur le serveur au moment precis ou il se remet.
       */
      return growth / 2 + random() * (growth / 2);
    },

    connecting() {
      status = everOnline ? 'reconnecting' : 'connecting';
    },

    opened() {
      // Une ouverture qu on n a pas demandee ne veut rien dire : on ignore.
      if (status === 'offline' || status === 'online') return;
      status = 'online';
      everOnline = true;
      attempts = 0;
    },

    failed() {
      if (status === 'online') return;
      status = 'offline';
      attempts += 1;
    },

    lost() {
      if (status !== 'online') return;
      status = 'offline';
      attempts += 1;
    },

    joinedMatch(id) {
      matchId = id;
    },

    leftMatch() {
      // Un match termine ne doit plus etre reclame : le serveur repondrait par
      // une erreur, et le client insisterait a chaque reconnexion.
      matchId = null;
    },

    resumeAction() {
      if (status !== 'online' || matchId === null) return null;
      return { type: 'rejoin', matchId };
    },
  };
}
