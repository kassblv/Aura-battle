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
   * Evenements refuses par le moteur, **par siege**.
   *
   * Comptes et non conserves : leur nombre interesse l'anti-triche, leur
   * contenu offrirait a un client bavard de quoi faire gonfler l'ecriture
   * jusqu'a la faire echouer.
   */
  readonly rejectedEvents: Readonly<Record<'a' | 'b', number>>;
  /** Entrees ecartees parce que le journal etait plein, par siege. */
  readonly droppedEvents: Readonly<Record<'a' | 'b', number>>;
  /**
   * Instants declares qui n'ont pas pu avoir lieu, **par siege**.
   *
   * Signal « Latence » du tableau de detection de docs/06. Le decoupage par
   * siege n'est pas un detail : ce document sanctionne un **joueur**, et ses
   * premieres sanctions sont automatiques. Un compteur commun aux deux sieges
   * imputerait a un joueur honnete les mensonges de ses adversaires.
   */
  readonly impossibleTaps: Readonly<Record<'a' | 'b', number>>;
}

/** Ecriture d'un match acheve. */
export interface MatchRepository {
  save(record: MatchRecord): Promise<void>;
}

/** Classement d'un siege avant et apres le match, et ce qu'il rapporte (docs/05, jalon M5). */
export interface SeatRatingOutcome {
  readonly before: { readonly leaguePoints: number; readonly league: string };
  readonly after: { readonly leaguePoints: number; readonly league: string };
  readonly rewards: { readonly softCurrency: number; readonly xp: number };
}

/**
 * Classement et recompenses d'un match acheve (docs/05, ADR 0010).
 *
 * Realise par `rating/application/rating-settlement.service.ts` — le module
 * match ne calcule rien, il decrit seulement ce dont il a besoin en retour.
 * Meme montage que `MatchOpening` (defini par `matchmaking`, realise par
 * `match/application/match-opener.ts`) : une interface definie a cote de son
 * seul appelant, implementee par une classe qui vit ailleurs.
 *
 * **Asynchrone, a la difference de tout le reste de ce fichier.** Le runtime
 * reste synchrone du premier tap au dernier ; seule la toute derniere etape —
 * apres que le match a deja son vainqueur — attend une lecture puis une
 * ecriture en base, pour que `match:end` porte un classement reel plutot
 * qu'un decor. `MatchRuntime.announceEnd` libere les sieges et le minuteur
 * **avant** cet appel, jamais apres : rien de ce qui suit ne doit retarder la
 * disponibilite des deux joueurs pour leur prochain match.
 */
export interface MatchRatingSettlement {
  settle(input: {
    readonly mode: MatchRecord['mode'];
    readonly seats: Readonly<Record<'a' | 'b', string>>;
    readonly result: { readonly winner: 'a' | 'b' | null; readonly reason: string };
    readonly atMs: number;
  }): Promise<Readonly<Record<'a' | 'b', SeatRatingOutcome>>>;
}
