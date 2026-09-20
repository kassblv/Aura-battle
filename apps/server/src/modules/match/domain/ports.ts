import type { ServerMessage, ServerMessageName } from '@aura/protocol';
import type { AmplifierLevel, Style, Tier, TimingQuality } from '@aura/rules';

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
  /**
   * Siege tenu par un fantome, s'il y en a un.
   *
   * `seats[ghost.seat]` vaut alors `null` : `MatchSeat.playerId` est nullable
   * « pour un fantome » (docs/04), et y ecrire l'identifiant synthetique du
   * siege ferait echouer la cle etrangere — le fantome n'est pas un joueur.
   * `Match.isGhost` et `MatchSeat.ghostOfId` gardent la trace de ce qui s'est
   * reellement passe, sans jamais pretendre que quelqu'un etait connecte.
   */
  readonly ghost: GhostSeatInfo | null;
}

/** Ecriture d'un match acheve. */
export interface MatchRepository {
  save(record: MatchRecord): Promise<void>;
}

/**
 * Une manche telle qu'un siege l'a jouee, pour rejeu ulterieur (docs/05).
 *
 * C'est **exactement** ce que `round:result` a deja revele des deux sieges :
 * enregistrer ne divulgue donc rien de plus que ce que le match a publie. Ni
 * les taps eux-memes ni la graine n'y figurent — un fantome rejoue sur une
 * autre sequence d'orbes et une autre jauge, seul le **niveau de jeu** se
 * transporte.
 */
export interface GhostRoundTrace {
  readonly move: { readonly style: Style; readonly tier: Tier };
  readonly amplifier: AmplifierLevel;
  readonly useUltimate: boolean;
  /** Qualite et ecart du tap de timing, tels que le moteur les a juges. */
  readonly timing: { readonly quality: TimingQuality; readonly delta: number };
  /** Points marques a la recharge : le « profil de recharge » de docs/05. */
  readonly rechargePoints: number;
  /** Nombre de taps comptabilises, seule valeur qui se rejoue telle quelle. */
  readonly rechargeTaps: number;
}

/**
 * Enregistrement d'un match pour servir de fantome (docs/05 § « Fantomes »).
 *
 * Realise par `matchmaking/application/ghost-recorder.service.ts` : meme
 * montage que `MatchRatingSettlement`, une interface declaree a cote de son
 * seul appelant et implementee ailleurs. Le runtime ne sait ni ou cela
 * s'ecrit, ni que le MMR doit y etre joint.
 *
 * **Appele pour les seuls matchs `RANKED` entre deux humains**, comme le
 * document l'exige : rejouer un fantome enregistrerait un fantome, et le
 * niveau de jeu de la file derivereait de copie en copie.
 */
export interface GhostRecorder {
  record(input: {
    readonly matchId: string;
    readonly seats: Readonly<Record<'a' | 'b', string>>;
    readonly rounds: Readonly<Record<'a' | 'b', readonly GhostRoundTrace[]>>;
    readonly atMs: number;
  }): Promise<void>;
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
    /**
     * Siege tenu par un fantome, s'il y en a un (docs/05 § « Fantomes »).
     *
     * Deux consequences, et aucune n'est optionnelle : **rien n'est ecrit au
     * classement de ce siege** — le joueur enregistre n'est pas la, et lui
     * infliger une defaite serait le classer sur un match qu'il n'a pas joue —
     * et son adversaire ne gagne que la moitie des LP habituels. Le `mmr` est
     * celui que porte l'enregistrement : c'est le seul niveau reel disponible
     * en face, et le classement en a besoin pour son score attendu.
     */
    readonly ghost?: GhostSeatInfo | null;
  }): Promise<Readonly<Record<'a' | 'b', SeatRatingOutcome>>>;
}

/** Un siege tenu par le rejeu d'un enregistrement plutot que par un joueur. */
export interface GhostSeatInfo {
  readonly seat: 'a' | 'b';
  /** MMR de l'enregistrement, c'est-a-dire du joueur au moment ou il a joue. */
  readonly mmr: number;
  /** Joueur dont cet enregistrement provient. Ecrit en base, jamais envoye. */
  readonly sourcePlayerId: string;
}
