import { defaultAnimationFor, effectForLevel, moveOfAnimation } from '@aura/content';
import type { ChallengeTracker } from '../../challenges/domain/ports.js';
import {
  emptyContribution,
  mergeContributions,
  roundContribution,
  type MatchContribution,
} from '../../challenges/domain/progress.js';
import type { ErrorCode, ServerMessage } from '@aura/protocol';
import {
  BALANCE,
  createMatch,
  opponentOf,
  reduce,
  RULES_VERSION,
  type BalanceConfig,
  type Choice,
  type ChoiceRejection,
  type MatchEffect,
  type MatchEvent,
  type MatchState,
  type RechargeTap,
  type RoundResult,
  type Seat,
} from '@aura/rules';
import { CONTENT_VERSION } from '@aura/content';
import { describeCause } from '../../../shared/describe-cause.js';
import type { AppLog } from '../../../shared/log-port.js';
import type {
  GhostRecorder,
  GhostRoundTrace,
  GhostSeatInfo,
  MatchClock,
  MatchNotifier,
  MatchRatingSettlement,
  MatchRecord,
  MatchRepository,
  SeatRatingOutcome,
  TimerScheduler,
} from '../domain/ports.js';
import { choiceStartFor, matchStateFor, rechargeStartFor, roundIntroFor } from './views.js';

/**
 * Classement neutre, quand il n'y en a pas de reel a montrer (docs/05).
 *
 * Trois cas s'y ramenent : aucun `MatchRatingSettlement` cable (tests d'avant
 * M5), le calcul a echoue, ou — a l'interieur meme du service — aucune saison
 * ne court. Dans les trois, `match:end` doit tout de meme partir : un
 * classement neutre vaut mieux qu'un ecran de fin de match qui ne vient
 * jamais.
 */
const NEUTRAL_RATING: Readonly<Record<Seat, SeatRatingOutcome>> = {
  a: {
    before: { leaguePoints: 0, league: 'sans_aura' },
    after: { leaguePoints: 0, league: 'sans_aura' },
    rewards: { softCurrency: 0, xp: 0, xpTotal: 0 },
  },
  b: {
    before: { leaguePoints: 0, league: 'sans_aura' },
    after: { leaguePoints: 0, league: 'sans_aura' },
    rewards: { softCurrency: 0, xp: 0, xpTotal: 0 },
  },
};

/**
 * Deroulement des matchs en cours (docs/02, docs/03 ; jalon M3).
 *
 * Le runtime ne decide rien : il applique `reduce` de `@aura/rules` et execute
 * les effets renvoyes — armer une echeance, envoyer un message, terminer.
 * Aucune regle de jeu n'est reecrite ici (regle d'or n°1).
 *
 * Tout message part par une des fonctions de vue, jamais construit sur place :
 * c'est ce qui tient la regle d'or n°4.
 */

/**
 * Ce qu'un siege porte, resolu a la connexion et fige pour le match.
 *
 * **Le serveur le sait, le client ne le dit pas.** Le cosmetique arrivait
 * avant dans `choice:lock`, donc declare par le client et relaye sans aucun
 * controle de possession : n'importe qui pouvait porter le skin a 850 pieces.
 * Regle d'or n°1 — le client n'envoie que des intentions, et une apparence
 * n'en est pas une, c'est un etat que la base detient deja.
 *
 * Fige pour la duree du match, a dessein : changer de tenue en pleine manche
 * ferait changer d'aura entre la revelation et le choc.
 */
export interface SeatWearing {
  /**
   * Les effets d'aura possedes, pas celui qui est equipe.
   *
   * Un skin habille UN niveau d'amplificateur (docs/01 §3), et le niveau joue
   * n'est connu qu'a la revelation : il n'y a donc rien a equiper d'avance.
   * Posseder, c'est porter — au niveau concerne, et seulement la.
   */
  readonly ownedEffects: readonly string[];
  /**
   * Tout ce que le joueur possede, objets offerts compris : c'est la que
   * `lockPose` verifie qu'une pose payante a bien ete obtenue.
   */
  readonly owned: readonly string[];
  /**
   * Ce que l'adversaire a le droit de voir des l'ouverture : tenue, coiffure,
   * couleur d'aura, danse signature.
   *
   * Rien ici ne depend d'un choix de manche, et c'est ce qui le rend public.
   * Absent : les defauts, comme un fantome ou un joueur dont l'inventaire n'a
   * pas repondu.
   */
  readonly look?: PublicLook;
}

/** L'apparence publique d'un siege, telle que `opponentCosmeticsSchema` la borne. */
export interface PublicLook {
  readonly outfit?: string;
  readonly hair?: string;
  readonly auraColor?: string;
  readonly signature?: string;
}

const NOTHING_WORN: SeatWearing = Object.freeze({
  ownedEffects: Object.freeze([]),
  owned: Object.freeze([]),
});

/** L'intention d'un verrouillage, telle que le client la formule (2.0.0). */
export interface PoseIntent {
  readonly poseId: string;
  readonly amplifier: Choice['amplifier'];
  readonly useUltimate: boolean;
}

export interface MatchSeats {
  readonly a: string;
  readonly b: string;
}

/** Cosmetique choisi pour une manche. Le gameplay l'ignore totalement. */
interface Cosmetic {
  readonly animationId: string;
  readonly effectId: string;
}

interface LiveMatch {
  readonly matchId: string;
  readonly seed: string;
  readonly seats: MatchSeats;
  /** Par quel chemin ce match a ete ouvert. Conserve tel quel a l'ecriture. */
  readonly mode: MatchRecord['mode'];
  readonly startedAtMs: number;
  state: MatchState;
  /** Cosmetiques de la manche en cours, par siege. */
  wearing: Record<Seat, SeatWearing>;
  /**
   * Ce que le match a rapporte a chaque siege, pour les defis quotidiens.
   *
   * Accumule MANCHE PAR MANCHE, et pas reconstruit a la fin : les chiffres de
   * recharge — points et meilleur combo — vivent dans `pending`, qui est remis
   * a zero au tour suivant. A la fin du match ils n'existent plus nulle part.
   */
  contributions: Record<Seat, MatchContribution>;
  /**
   * Dernier `seq` traite par siege.
   *
   * Le protocole impose un compteur croissant par client (docs/03). Sans lui,
   * un client qui se reconnecte et renvoie ses taps par securite les fait
   * compter deux fois — un champ valide mais jamais lu donne l'illusion d'une
   * protection.
   */
  lastSeq: Record<Seat, number>;
  /**
   * Journal des evenements appliques.
   *
   * Graine + journal = le match rejouable a l'identique. C'est la seule facon
   * de trancher un litige sur un resultat autrement que sur parole.
   */
  readonly journal: { atMs: number; event: MatchEvent }[];
  /**
   * Evenements refuses par le moteur, comptes mais pas conserves.
   *
   * Leur nombre interesse l'anti-triche ; leur contenu, non. Les garder
   * offrirait justement le levier qu'on veut retirer.
   */
  rejected: Record<Seat, number>;
  /** Entrees ecartees faute de place au journal. */
  dropped: Record<Seat, number>;
  /**
   * Instants declares qui n'ont pas pu avoir lieu.
   *
   * Conserves comme un compteur : c'est le signal « Latence » du tableau de
   * detection de docs/06, et sans instant d'arrivee memorise il serait tout
   * simplement inobservable.
   *
   * **Par siege, et c'est essentiel.** `docs/06` ne sanctionne pas un match,
   * il sanctionne un joueur — et les premieres sanctions sont automatiques,
   * avant toute revue humaine. Un compteur commun attribuerait a un joueur
   * honnete les mensonges de ses adversaires : un tricheur prolifique
   * empoisonnerait le score de suspicion de chaque personne qu'il croise.
   */
  impossibleTaps: Record<Seat, number>;
  /**
   * La pose verrouillee par siege, avec la manche ou elle l'a ete.
   *
   * La manche fait partie de la valeur : un siege qui ne verrouille pas a la
   * manche suivante joue le choix par defaut du moteur, et lui montrer la
   * pose de la manche d'avant ferait danser un mouvement qu'il ne joue pas.
   */
  poses: Record<Seat, { readonly round: number; readonly poseId: string } | null>;
  /** Transitions de phase deja journalisees, pour tenir leur reserve. */
  phaseEntries: number;
  /**
   * Siege tenu par un fantome, ou `null` si deux personnes jouent.
   *
   * Le runtime ne rejoue rien lui-meme — c'est `GhostDirector` qui envoie les
   * taps et les verrouillages, par les memes methodes qu'un client. Ce champ ne
   * sert qu'aux trois endroits ou la difference se voit : ne pas ecrire de
   * `playerId` inexistant en base, ne rien inscrire au classement d'un absent,
   * et ne pas enregistrer un fantome comme modele de fantome.
   */
  readonly ghost: GhostSeatInfo | null;
  /**
   * Ce qu'on montre du fantome a son adversaire, resolu a l'ouverture.
   *
   * Separe de `ghost` a dessein : celui-la part au classement et en base, ou un
   * nom d'affichage n'a rien a faire. Celui-ci ne sert qu'a rappeler, apres une
   * reconnexion, ce que `match:found` avait deja annonce.
   */
  readonly ghostOpponent: { readonly displayName: string; readonly league: string } | null;
  /**
   * Ce que chaque siege a joue, manche par manche (docs/05 § « Fantomes »).
   *
   * Recopie au moment ou `round:result` part : ces valeurs viennent d'etre
   * rendues publiques aux deux joueurs, les conserver ne divulgue donc rien.
   * Rien n'est recalcule ici — ni cout, ni qualite, ni points (regle d'or n°1).
   */
  readonly ghostTrace: Record<Seat, GhostRoundTrace[]>;
}

const SEATS: readonly Seat[] = ['a', 'b'];

/**
 * Delai avant qu'une deconnexion devienne definitive (docs/03).
 *
 * Quarante-cinq secondes : assez pour un tunnel, un changement de reseau ou
 * une mise en arriere-plan, trop peu pour attendre indefiniment quelqu'un qui
 * est parti. Entre les deux, le match continue sans lui et les actions par
 * defaut s'appliquent — il n'est pas puni, il joue mal.
 */
const DISCONNECT_GRACE_MS = 45_000;

/**
 * Nombre maximal d'entrees conservees au journal d'un match.
 *
 * Un match honnete en produit quelques dizaines : quatre echeances de phase et
 * deux verrouillages par manche, plus les lots de taps. Le plafond existe pour
 * qu'un client bavard ne puisse pas gonfler le journal jusqu'a faire echouer
 * son ecriture — ce journal part dans une seule colonne JSON, au sein d'une
 * transaction qui expire, et son echec fait perdre **tout** le match : graine
 * et manches comprises. Celui qui a interet a effacer ses traces ne doit pas
 * pouvoir y arriver en parlant trop.
 */
const MAX_JOURNAL_ENTRIES = 500;

/**
 * Places reservees aux transitions de phase dans le journal.
 *
 * Toutes les entrees n'ont pas la meme valeur. Les `PHASE_TIMEOUT` font avancer
 * la machine a etats : ce sont eux le **squelette** du rejeu, les lots de taps
 * n'en sont que la chair. Un journal de 484 lots de taps ampute de ses
 * transitions ne rejoue rien du tout, alors que l'inverse rejoue l'essentiel.
 *
 * Un match en produit au plus une quinzaine — quatre par manche, trois manches.
 * Trente-deux places laissent le double de marge, et garantissent surtout qu'une
 * transition n'est **jamais** perdue : la comptabilite du journal boucle donc,
 * et rien ne disparait sans compteur.
 */
const PHASE_JOURNAL_RESERVE = 32;

/**
 * Tolerances reseau (docs/03-pvp-protocol.md, tableau « Validation serveur »).
 *
 * Elles vivent **ici et non dans `@aura/rules`** : une tolerance reseau n'est
 * pas une regle de jeu, et le moteur doit pouvoir rejouer un match sans jamais
 * entendre parler de latence. Le moteur dit ce qui est jouable ; le serveur dit
 * ce qui est arrive a temps.
 */
const TAP_TOLERANCE_MS = 400;
const LOCK_TOLERANCE_MS = 300;

/**
 * Marge d'horloge accordee a un instant declare par le client.
 *
 * Le client mesure ses instants avec `performance.now()` depuis le debut de
 * phase, le serveur mesure l'arrivee avec la sienne : les deux ne coincident
 * jamais exactement. La marge absorbe cet ecart — elle ne doit pas absorber
 * cinq secondes de calcul hors ligne.
 */
const CLOCK_ALLOWANCE_MS = 250;

/**
 * Mouvement attribue a un siege qui n'a pas verrouille.
 *
 * Le moteur joue « palier 0 d'un style tire par la graine » (`@aura/rules`,
 * §9) ; le serveur, lui, n'a qu'a **nommer** ce qui s'est passe pour la
 * revelation et pour la trace de fantome. Une seule constante pour les deux :
 * deux replis differents montreraient deux mouvements differents pour la meme
 * manche.
 */
const FALLBACK_MOVE = { style: 'calme', tier: 0 } as const;

/** Cle du minuteur de deconnexion d'un siege. */
const disconnectKey = (matchId: string, seat: Seat): string => `${matchId}:disconnect:${seat}`;

/**
 * Correspondance entre les refus du moteur et les codes du protocole.
 *
 * Les deux vocabulaires sont volontairement distincts : le moteur parle de
 * regles de jeu, le protocole parle au client. Les relier ici, explicitement,
 * evite qu'un refus interne se retrouve tel quel sur le reseau.
 */
const REJECTION_CODES: Readonly<Record<ChoiceRejection, ErrorCode>> = {
  NOT_IN_CHOICE_PHASE: 'WRONG_PHASE',
  ALREADY_LOCKED: 'ALREADY_LOCKED',
  NOT_ENOUGH_ENERGY: 'NOT_ENOUGH_ENERGY',
  ULTIMATE_NOT_READY: 'ULT_NOT_READY',
};

export class MatchRuntime {
  private readonly matches = new Map<string, LiveMatch>();

  /**
   * Ou est assis chaque joueur.
   *
   * Un index plutot qu'un balayage : `locate` parcourait toutes les parties
   * vivantes a chaque connexion et chaque deconnexion, ce qu'une file
   * d'attente rendrait couteux. Mais surtout, il ne rendait que la PREMIERE
   * trouvee — ce qui rendait un double siege invisible au lieu de le rendre
   * impossible.
   */
  private readonly seatedIn = new Map<string, string>();

  constructor(
    private readonly notifier: MatchNotifier,
    private readonly scheduler: TimerScheduler,
    private readonly clock: MatchClock,
    /**
     * Valeurs de jeu. Injectable a dessein : les tests de bout en bout
     * raccourcissent les phases pour jouer un match entier en une seconde, et
     * les evenements de live-ops (docs/07) feront varier les regles en donnee.
     */
    private readonly config: BalanceConfig = BALANCE,
    /** Ecriture du match acheve. Absente, les matchs ne sont pas conserves. */
    private readonly repository: MatchRepository | null = null,
    /** Classement et recompenses de fin de match. Absent, `match:end` reste neutre (jalon M5). */
    private readonly ratingSettlement: MatchRatingSettlement | null = null,
    private readonly log: AppLog | null = null,
    /**
     * Enregistrement des fantomes (docs/05). Absent, on ne conserve rien — un
     * serveur sans fantomes reste un serveur qui marche.
     */
    private readonly ghostRecorder: GhostRecorder | null = null,
    /**
     * Defis quotidiens (docs/01 §11). Absent, on ne compte rien — un serveur
     * sans defis reste un serveur qui marche.
     */
    private readonly challengeTracker: ChallengeTracker | null = null,
  ) {}

  /**
   * Enregistre ce que porte un siege.
   *
   * Appele par l'ouvreur juste apres la creation, avec ce que la presence a
   * resolu a la connexion. Separe de `createMatch` pour ne pas obliger ses
   * trois appelants a porter une donnee dont deux n'ont que faire — et parce
   * qu'un match sans cette information reste un match qui marche : chacun y
   * porte l'effet offert de son palier, comme tout le monde avant la boutique.
   */
  setWearing(matchId: string, seat: Seat, wearing: SeatWearing): void {
    const match = this.matches.get(matchId);
    if (match === undefined) return;
    match.wearing[seat] = wearing;
  }

  /**
   * L'apparence publique d'un siege, telle qu'annoncee a l'ouverture.
   *
   * La reprise (`match:state`) la rappelle a l'adversaire : un client tue en
   * arriere-plan revenait sinon face a une silhouette par defaut.
   */
  publicLookOf(matchId: string, seat: Seat): PublicLook | null {
    const match = this.matches.get(matchId);
    if (match === undefined) return null;
    return match.wearing[seat].look ?? {};
  }

  /**
   * Signale la deconnexion d'un joueur.
   *
   * Le match **continue** : couper tout de suite punirait quelqu'un qui passe
   * sous un tunnel. On arme seulement le compte a rebours au bout duquel la
   * deconnexion devient un abandon.
   */
  notePlayerDisconnected(playerId: string): void {
    const found = this.locate(playerId);
    if (found === null) return;

    const { match, seat } = found;
    this.scheduler.schedule(
      disconnectKey(match.matchId, seat),
      this.clock.now() + DISCONNECT_GRACE_MS,
      () => {
        // Le match peut s'etre termine entre-temps ; `forfeit` l'ignore alors.
        this.forfeit(match.matchId, seat);
      },
    );
  }

  /** Le joueur est revenu : on desarme le compte a rebours. */
  notePlayerReconnected(playerId: string): void {
    const found = this.locate(playerId);
    if (found === null) return;
    this.scheduler.cancel(disconnectKey(found.match.matchId, found.seat));
  }

  /**
   * Accepte un numero d'action, ou le rejette comme deja traite.
   *
   * Idempotence : rejouer une action deja prise en compte ne doit rien
   * changer. On compare au dernier numero vu plutot que de tenir la liste de
   * tous les numeros — le protocole garantit qu'ils croissent.
   */
  /**
   * Une action de joueur (taps, verrouillage) est-elle a traiter ?
   *
   * Elle doit viser la manche EN COURS, puis porter un seq neuf — dans cet
   * ordre, pour qu'une action refusee pour sa manche ne consomme pas son
   * numero. Le seq est garde pour tout le match : sans ce premier filtre, un
   * verrouillage reste dans le tampon de Socket.IO pendant une coupure, et
   * vide a la reconnexion, verrouillait la manche SUIVANTE a la place du
   * joueur.
   *
   * Pas de compteur de suspicion ici : un message d'une manche passee est le
   * symptome ordinaire d'une coupure, et `docs/06` sanctionne un joueur
   * automatiquement sur ces compteurs.
   */
  acceptAction(matchId: string, seat: Seat, round: number, seq: number): boolean {
    const match = this.matches.get(matchId);
    if (match === undefined) return false;
    if (round !== match.state.round) return false;
    return this.acceptSeq(matchId, seat, seq);
  }

  acceptSeq(matchId: string, seat: Seat, seq: number): boolean {
    const match = this.matches.get(matchId);
    if (match === undefined) return false;
    if (seq <= match.lastSeq[seat]) return false;
    match.lastSeq[seat] = seq;
    return true;
  }

  /**
   * Reste-t-il de la place au journal pour cette entree ?
   *
   * Les transitions de phase puisent dans une reserve qui leur est propre : un
   * joueur bavard ne peut donc pas les chasser du journal, et le squelette du
   * rejeu survit toujours a la troncature.
   */
  private hasRoomInJournal(match: LiveMatch, seat: Seat | null): boolean {
    if (seat === null) {
      return match.phaseEntries < PHASE_JOURNAL_RESERVE;
    }
    return match.journal.length - match.phaseEntries < MAX_JOURNAL_ENTRIES - PHASE_JOURNAL_RESERVE;
  }

  /** Retrouve le match et le siege d'un joueur, s'il en a un. */
  private locate(playerId: string): { match: LiveMatch; seat: Seat } | null {
    const matchId = this.seatedIn.get(playerId);
    if (matchId === undefined) return null;
    const match = this.matches.get(matchId);
    if (match === undefined) return null;
    const seat = SEATS.find((candidate) => match.seats[candidate] === playerId);
    return seat === undefined ? null : { match, seat };
  }

  /** Ce joueur occupe-t-il deja un siege ? */
  isBusy(playerId: string): boolean {
    return this.locate(playerId) !== null;
  }

  /**
   * Nombre de matchs vivants sur ce noeud.
   *
   * Publie pour la sonde de charge (jalon M7) : un banc qui annonce 500 matchs
   * simultanes doit pouvoir le **verifier** cote serveur, sinon il mesure ce
   * qu'il croit avoir ouvert plutot que ce qui tourne vraiment.
   */
  get liveMatches(): number {
    return this.matches.size;
  }

  /** Phase d'un match en cours, ou `null` s'il n'existe pas (ou plus). */
  phaseOf(matchId: string): MatchState['phase'] | null {
    return this.matches.get(matchId)?.state.phase ?? null;
  }

  /** Siege occupe par un joueur dans ce match. */
  seatOf(matchId: string, playerId: string): Seat | null {
    const match = this.matches.get(matchId);
    if (match === undefined) return null;
    return SEATS.find((seat) => match.seats[seat] === playerId) ?? null;
  }

  /**
   * Ouvre un match, ou refuse.
   *
   * Le refus vit ICI et pas seulement dans la passerelle : c'est le seul
   * endroit qu'aucun chemin d'ouverture — invitation, file d'attente, revanche
   * — ne peut contourner, et il est synchrone, donc aucune attente ne peut
   * s'intercaler entre le controle et la reservation des sieges.
   */
  createMatch(input: {
    matchId: string;
    seed: string;
    seats: MatchSeats;
    /**
     * Chemin d'ouverture, enregistre avec le match.
     *
     * Absent, c'est une invitation : le seul chemin qui existait avant la file
     * d'attente. Un match classe ecrit `RANKED` en base, faute de quoi le
     * classement compterait plus tard des parties d'invitation.
     */
    mode?: MatchRecord['mode'];
    /**
     * Siege tenu par un fantome (docs/05). Le fantome porte un identifiant de
     * siege synthetique, unique : les refus ci-dessous — deux sieges
     * identiques, joueur deja assis — s'appliquent donc a lui comme a tout le
     * monde, sans exception a creuser.
     */
    ghost?: (GhostSeatInfo & { displayName: string; league: string }) | null;
  }): boolean {
    if (this.matches.has(input.matchId)) return false;
    /**
     * « Libre » inclut « pas deja l'autre siege de ce match ».
     *
     * `isBusy` ne peut pas l'attraper : au moment du controle le match n'existe
     * pas encore, donc les deux appels rendent `false` pour le meme joueur
     * libre, et l'index `seatedIn` ecrivait deux fois la meme cle. Un joueur
     * assis contre lui-meme controle les deux choix et gagne a coup sur.
     *
     * Seule `invites.ts` l'empechait, en refusant de rejoindre sa propre
     * invitation — une garde du CHEMIN, pas de l'ouverture. La file d'attente
     * est un second chemin, et l'invariant n'a pas a dependre de celui qu'on
     * emprunte.
     */
    if (input.seats.a === input.seats.b) return false;
    if (SEATS.some((seat) => this.isBusy(input.seats[seat]))) return false;

    const step = createMatch(input.seed, {
      startedAtMs: this.clock.now(),
      config: this.config,
    });
    const match: LiveMatch = {
      matchId: input.matchId,
      seed: input.seed,
      seats: input.seats,
      mode: input.mode ?? 'INVITE',
      startedAtMs: this.clock.now(),
      state: step.state,
      wearing: { a: NOTHING_WORN, b: NOTHING_WORN },
      contributions: { a: emptyContribution(), b: emptyContribution() },
      // -1 et non 0 : le protocole admet `seq = 0`, et c'est le premier numero
      // qu'envoie le client. Parti de 0, ce compteur jetait le premier message
      // de chaque match — parfois le verrouillage lui-meme.
      lastSeq: { a: -1, b: -1 },
      journal: [],
      rejected: { a: 0, b: 0 },
      dropped: { a: 0, b: 0 },
      impossibleTaps: { a: 0, b: 0 },
      poses: { a: null, b: null },
      phaseEntries: 0,
      ghost:
        input.ghost == null
          ? null
          : {
              seat: input.ghost.seat,
              mmr: input.ghost.mmr,
              sourcePlayerId: input.ghost.sourcePlayerId,
            },
      ghostOpponent:
        input.ghost == null
          ? null
          : { displayName: input.ghost.displayName, league: input.ghost.league },
      ghostTrace: { a: [], b: [] },
    };
    this.matches.set(input.matchId, match);
    for (const seat of SEATS) {
      this.seatedIn.set(input.seats[seat], input.matchId);
    }
    this.runEffects(match, step.effects);
    return true;
  }

  /** Instantane de reprise pour un siege, sans information cachee. */
  /** Qui occupe l'autre siege, ou `null` si le match n'existe pas (ou plus). */
  opponentIn(matchId: string, seat: Seat): string | null {
    const match = this.matches.get(matchId);
    return match === undefined ? null : match.seats[opponentOf(seat)];
  }

  snapshotFor(matchId: string, seat: Seat): ServerMessage<'match:state'> | null {
    const match = this.matches.get(matchId);
    if (match === undefined) return null;
    return matchStateFor(seat, match.state, matchId, this.facesGhost(match, seat));
  }

  /**
   * Ce que le siege d'en face montre de lui, s'il s'agit d'un rejeu.
   *
   * `null` des que l'adversaire est une personne : la passerelle retombe alors
   * sur le registre des sessions, comme avant. C'est ce qui permet a une
   * reprise apres reconnexion de reafficher « Aura anonyme » plutot que le
   * nom de repli d'un joueur qu'on ne trouve pas — un fantome n'a pas de
   * session, donc l'annuaire n'a jamais rien a en dire.
   */
  ghostOpponentIn(
    matchId: string,
    seat: Seat,
  ): { readonly displayName: string; readonly league: string } | null {
    const match = this.matches.get(matchId);
    if (match === undefined) return null;
    return this.facesGhost(match, seat) ? match.ghostOpponent : null;
  }

  /** Ce siege a-t-il un rejeu en face de lui ? */
  private facesGhost(match: LiveMatch, seat: Seat): boolean {
    return match.ghost !== null && match.ghost.seat !== seat;
  }

  /**
   * Enregistre des taps, apres avoir ecarte ceux qui n'ont pas pu avoir lieu.
   *
   * Un tap annonce a `t = 5800 ms` dans un lot qui arrive 200 ms apres le debut
   * de la phase pretend s'etre produit dans le futur. Sans cette confrontation
   * entre l'instant **declare** et l'instant **vecu**, un bot peut rester muet,
   * recevoir la sequence d'orbes, calculer hors ligne le programme parfait et
   * l'envoyer d'un coup : le moteur rejoue la scene et n'y voit rien d'anormal
   * — instants croissants, orbes vivantes, cadence respectee.
   */
  submitTaps(matchId: string, seat: Seat, taps: readonly RechargeTap[]): void {
    const match = this.matches.get(matchId);
    if (match === undefined) return;

    const arrivedAtMs = this.clock.now();

    // Hors phase de recharge, le temps ecoule « depuis le debut de la
    // recharge » n'a aucun sens : on laisse le moteur refuser, pour que le
    // refus soit compte et impute au bon siege. Filtrer ici avalerait
    // l'evenement avant qu'il ne soit vu.
    if (match.state.phase !== 'recharge') {
      this.apply(match, { type: 'RECHARGE_TAPS', seat, taps, atMs: arrivedAtMs });
      return;
    }

    const phaseStartedAtMs = match.state.phaseEndsAtMs - this.config.phases.rechargeMs;
    const elapsedMs = arrivedAtMs - phaseStartedAtMs;
    const latest = elapsedMs + TAP_TOLERANCE_MS + CLOCK_ALLOWANCE_MS;

    const plausible = taps.filter((tap) => tap.atMs <= latest);
    if (plausible.length < taps.length) {
      match.impossibleTaps[seat] += taps.length - plausible.length;
    }
    if (plausible.length === 0) return;

    this.apply(match, { type: 'RECHARGE_TAPS', seat, taps: plausible, atMs: arrivedAtMs });
  }

  /**
   * Vrai si un tap de timing annonce a `tapAtMs` a pu avoir lieu.
   *
   * Meme principe que pour les taps de recharge : verrouiller 200 ms apres le
   * debut de la phase en declarant une charge de 4 secondes, c'est declarer un
   * temps qui ne s'est pas ecoule.
   */
  private timingIsPlausible(match: LiveMatch, tapAtMs: number | null): boolean {
    if (tapAtMs === null) return true;
    const phaseStartedAtMs = match.state.phaseEndsAtMs - this.config.phases.choiceMs;
    const elapsedMs = this.clock.now() - phaseStartedAtMs;
    return tapAtMs <= elapsedMs + LOCK_TOLERANCE_MS + CLOCK_ALLOWANCE_MS;
  }

  /**
   * Verrouille une POSE, l'intention que le client envoie depuis la 2.0.0.
   *
   * Le mouvement se deduit du catalogue, jamais du client. Une pose inconnue,
   * ou payante sans avoir ete obtenue, est refusee et imputee au seul siege
   * fautif (`rejected`, docs/06) : un client honnete n'en envoie jamais. Le
   * siege n'est alors pas verrouille, et l'adversaire n'en apprend rien.
   */
  lockPose(matchId: string, seat: Seat, intent: PoseIntent, timingTapAtMs: number | null): void {
    const match = this.matches.get(matchId);
    if (match === undefined) return;

    const move = moveOfAnimation(intent.poseId);
    const offered = move !== null && defaultAnimationFor(move) === intent.poseId;
    if (move === null || (!offered && !match.wearing[seat].owned.includes(intent.poseId))) {
      match.rejected[seat] += 1;
      // Au seul interesse, et rejouable : un client honnete a l'inventaire
      // perime (pose obtenue sur un autre appareil) doit pouvoir verrouiller
      // autre chose plutot que perdre sa manche en silence.
      this.notifier.send(match.seats[seat], 'error', {
        code: move === null ? 'INVALID_PAYLOAD' : 'COSMETIC_NOT_OWNED',
        message: move === null ? 'pose inconnue' : 'pose non possedee',
        retryable: true,
      });
      return;
    }

    // Posee AVANT le verrouillage : le second siege a verrouiller declenche la
    // resolution de la manche dans le meme appel, et la revelation lit la pose
    // a cet instant-la. Retiree si le moteur refuse le choix.
    const previous = match.poses[seat];
    match.poses[seat] = { round: match.state.round, poseId: intent.poseId };
    const choice: Choice = { move, amplifier: intent.amplifier, useUltimate: intent.useUltimate };
    if (!this.lockChoice(matchId, seat, choice, timingTapAtMs)) match.poses[seat] = previous;
  }

  /**
   * Verrouille un choix deja resolu. Rend `true` si le moteur l'a accepte.
   *
   * C'est le chemin des fantomes et des bots, qui n'ont pas de pose : la
   * revelation leur montre la pose offerte de leur case.
   */
  lockChoice(matchId: string, seat: Seat, choice: Choice, timingTapAtMs: number | null): boolean {
    const match = this.matches.get(matchId);
    if (match === undefined) return false;

    // Un timing qui annonce plus de temps qu'il ne s'en est ecoule est
    // impossible : on le remplace par « pas de tap » plutot que de refuser le
    // verrouillage, ce qui laisserait le tricheur rejouer indefiniment.
    const timing = this.timingIsPlausible(match, timingTapAtMs) ? timingTapAtMs : null;
    if (timing !== timingTapAtMs) {
      match.impossibleTaps[seat] += 1;
    }

    const before = match.state.pending[seat].locked;
    this.apply(match, {
      type: 'CHOICE_LOCKED',
      seat,
      choice,
      timingTapAtMs: timing,
      atMs: this.clock.now(),
    });

    // Le verrouillage a-t-il ete accepte ? Si oui, l'adversaire apprend ce
    // seul fait — ni le mouvement, ni le timing, ni le cout.
    const after = this.matches.get(matchId)?.state.pending[seat].locked;
    const accepted = before === null && after !== null && after !== undefined;
    if (accepted) {
      const opponent = opponentOf(seat);
      this.notifier.send(match.seats[opponent], 'opponent:locked', {
        matchId,
        round: match.state.round,
      });
    }
    return accepted;
  }

  forfeit(matchId: string, seat: Seat): void {
    const match = this.matches.get(matchId);
    if (match === undefined) return;
    this.apply(match, { type: 'PLAYER_FORFEIT', seat, atMs: this.clock.now() });
  }

  /** Echeance de phase : c'est le serveur qui decide quand elle tombe. */
  private handleTimeout(matchId: string): void {
    const match = this.matches.get(matchId);
    if (match === undefined) return;
    this.apply(match, { type: 'PHASE_TIMEOUT', atMs: match.state.phaseEndsAtMs });
  }

  private apply(match: LiveMatch, event: MatchEvent): void {
    const atMs = this.clock.now();
    const step = reduce(match.state, event, this.config);

    // On ne journalise qu'un evenement **accepte**. Le moteur renvoie l'etat
    // inchange — le meme objet — quand il ignore un evenement ; c'est ce qui
    // permet de faire la difference sans dupliquer sa logique de validation.
    // Un `PHASE_TIMEOUT` ne porte pas de siege : il vient de notre propre
    // minuteur. Un refus de ce cote est un defaut du serveur, jamais la faute
    // d'un joueur — on ne l'impute a personne.
    const seat: Seat | null = 'seat' in event ? event.seat : null;

    if (step.state === match.state) {
      if (seat !== null) match.rejected[seat] += 1;
    } else if (this.hasRoomInJournal(match, seat)) {
      match.journal.push({ atMs, event });
      if (seat === null) match.phaseEntries += 1;
    } else if (seat !== null) {
      match.dropped[seat] += 1;
    }

    match.state = step.state;
    this.runEffects(match, step.effects);
  }

  private runEffects(match: LiveMatch, effects: readonly MatchEffect[]): void {
    for (const effect of effects) {
      switch (effect.type) {
        case 'PHASE_STARTED':
          this.announcePhase(match, effect.phase, effect.endsAtMs);
          break;
        case 'ROUND_RESOLVED':
          this.announceResult(match, effect.result);
          break;
        case 'CHOICE_REJECTED':
          this.notifier.send(match.seats[effect.seat], 'error', {
            code: REJECTION_CODES[effect.reason],
            message: 'choix refuse',
            // Un choix deja verrouille ne se rejoue pas ; les autres refus
            // laissent au joueur la possibilite d'en proposer un autre.
            retryable: effect.reason !== 'ALREADY_LOCKED',
          });
          break;
        case 'MATCH_ENDED':
          this.announceEnd(match, effect.result);
          break;
      }
    }
  }

  private announcePhase(match: LiveMatch, phase: MatchState['phase'], endsAtMs: number): void {
    // L'echeance est armee avant l'envoi : si le client ne repond jamais, la
    // phase se ferme quand meme.
    this.scheduler.schedule(match.matchId, endsAtMs, () => {
      this.handleTimeout(match.matchId);
    });

    for (const seat of SEATS) {
      const player = match.seats[seat];
      switch (phase) {
        case 'intro':
          this.notifier.send(
            player,
            'round:intro',
            roundIntroFor(seat, match.state, match.matchId),
          );
          break;
        case 'recharge':
          this.notifier.send(
            player,
            'recharge:start',
            rechargeStartFor(match.state, match.matchId),
          );
          break;
        case 'choice':
          this.notifier.send(
            player,
            'choice:start',
            choiceStartFor(seat, match.state, match.matchId),
          );
          break;
        case 'reveal':
        case 'ended':
          break;
      }
    }
  }

  /**
   * Ce que l'adversaire voit de ce siege a la revelation.
   *
   * Resolu **ici**, a partir du palier reellement joue et de ce que le joueur
   * possede en base. Deux choses que le client ne peut pas mentir, parce
   * qu'il ne les fournit plus : le cosmetique arrivait avant dans
   * `choice:lock`, sans controle de possession.
   *
   * L'effet suit le NIVEAU joue (docs/01 §3) : un skin achete habille un seul
   * amplificateur. C'est ce qui le fait apparaitre au moment ou on l'a paye,
   * et c'est aussi ce qui garde l'amplificateur lisible — son nom est celui de
   * son effet, et un skin qui deborderait sur les cinq niveaux effacerait
   * l'information que la revelation existe pour donner.
   */
  private cosmeticOf(match: LiveMatch, seat: Seat, result: RoundResult): Cosmetic {
    const locked = match.state.pending[seat].locked;
    const move = locked?.choice.move ?? FALLBACK_MOVE;
    const amplifier = locked?.choice.amplifier ?? 0;
    const wearing = match.wearing[seat];
    const pose = match.poses[seat];
    void result;

    return {
      animationId:
        locked !== null && pose !== null && pose.round === match.state.round
          ? pose.poseId
          : defaultAnimationFor(move),
      effectId: effectForLevel(amplifier, wearing.ownedEffects).id,
    };
  }

  private announceResult(match: LiveMatch, result: RoundResult): void {
    /*
      Les defis avancent ICI, pas a la fin du match.

      Les chiffres de recharge — points, meilleur combo — vivent dans
      `pending`, remis a zero des la manche suivante. A la fin du match ils
      n'existent plus nulle part : les compter plus tard reviendrait a les
      compter a zero, ce qui rendrait deux defis sur cinq impossibles a finir
      sans qu'aucune erreur ne soit levee.
    */
    for (const seat of SEATS) {
      const outcome = result.seats[seat];
      const recharge = match.state.pending[seat].recharge;
      match.contributions[seat] = mergeContributions(
        match.contributions[seat],
        roundContribution({
          countered: outcome.countered,
          perfect: outcome.timing.quality === 'perfect',
          rechargePoints: recharge?.points ?? 0,
          bestCombo: recharge?.bestCombo ?? 0,
        }),
      );
    }

    const sideFor = (seat: Seat): ServerMessage<'round:result'>['sides']['a'] => {
      const outcome = result.seats[seat];
      const locked = match.state.pending[seat].locked;
      const recharge = match.state.pending[seat].recharge;
      const move = locked?.choice.move ?? FALLBACK_MOVE;

      return {
        move,
        amp: locked?.choice.amplifier ?? 0,
        ult: locked?.choice.useUltimate ?? false,
        cosmetic: this.cosmeticOf(match, seat, result),
        recharge: {
          points: recharge?.points ?? 0,
          bestCombo: recharge?.bestCombo ?? 0,
          boostPct: match.state.pending[seat].boostPercent,
          ultGain: recharge?.ultimateGain ?? 0,
          energyGain: recharge?.energyGain ?? 0,
        },
        // Repris de la resolution, jamais recalcule ici.
        timing: { quality: outcome.timing.quality, error: outcome.timing.delta },
        repeat: outcome.repeated,
        counter: outcome.countered,
        countered: outcome.wasCountered,
        counterBlocked: outcome.counterBlocked,
        base: outcome.base,
        final: outcome.score,
        energyAfter: match.state.seats[seat].energy,
        ultAfter: match.state.seats[seat].ultimateGauge,
      };
    };

    const payload: ServerMessage<'round:result'> = {
      matchId: match.matchId,
      // `state.round` a deja avance si la manche s'est enchainee : on lit le
      // rang de la manche dans l'historique, qui ne bouge plus.
      round: match.state.history.length,
      sides: { a: sideFor('a'), b: sideFor('b') },
      winner: result.winner,
      roundsWon: { a: match.state.seats.a.roundsWon, b: match.state.seats.b.roundsWon },
      // On revele le perdant en premier : le vainqueur ferme la scene.
      timeline: { revealFirst: result.winner === 'a' ? 'b' : 'a' },
    };

    for (const seat of SEATS) {
      this.notifier.send(match.seats[seat], 'round:result', payload);
    }

    /**
     * Trace pour les fantomes (docs/05), prise sur ce qui vient d'etre envoye.
     *
     * Le moment n'est pas indifferent : `pending` porte encore les choix et la
     * recharge de la manche, et ils viennent d'etre reveles aux deux joueurs.
     * Plus tard, `afterReveal` remet `pending` a zero et l'information est
     * perdue ; plus tot, elle serait encore secrete.
     */
    for (const seat of SEATS) {
      const locked = match.state.pending[seat].locked;
      const pending = match.state.pending[seat];
      match.ghostTrace[seat].push({
        // Meme repli que la vue ci-dessus : qui n'a pas verrouille a joue
        // l'action par defaut, et c'est bien ce que son adversaire a vu.
        move: locked?.choice.move ?? FALLBACK_MOVE,
        amplifier: locked?.choice.amplifier ?? 0,
        useUltimate: locked?.choice.useUltimate ?? false,
        // Repris de la resolution, jamais recalcule (regle d'or n°1).
        timing: {
          quality: result.seats[seat].timing.quality,
          delta: result.seats[seat].timing.delta,
        },
        rechargePoints: pending.recharge?.points ?? 0,
        rechargeTaps: pending.taps.length,
      });
    }
  }

  /**
   * Fin de match : libere les sieges sur-le-champ, puis annonce un
   * classement reel (docs/05, jalon M5).
   *
   * **La liberation des sieges et du minuteur passe avant tout le reste, et
   * ne depend d'aucune attente.** Le classement, lui, a besoin d'une lecture
   * puis d'une ecriture en base (`MatchRatingSettlement.settle`) : le
   * decoupage garantit qu'une base lente retarde au pire l'ecran de fin de
   * match, jamais la disponibilite des deux joueurs pour le suivant.
   */
  private announceEnd(match: LiveMatch, result: { winner: Seat | null; reason: string }): void {
    // Un match termine ne doit plus rien retenir : ni minuteur, ni memoire.
    this.scheduler.cancel(match.matchId);
    for (const seat of SEATS) {
      this.scheduler.cancel(disconnectKey(match.matchId, seat));
    }
    this.matches.delete(match.matchId);
    // Sans cette liberation, un joueur reste « occupe » pour toujours et ne
    // peut plus jamais rejoindre de partie — un defaut silencieux.
    for (const seat of SEATS) {
      if (this.seatedIn.get(match.seats[seat]) === match.matchId) {
        this.seatedIn.delete(match.seats[seat]);
      }
    }

    this.persist(match, result);
    this.recordGhost(match);
    this.recordChallenges(match, result);

    if (this.ratingSettlement === null) {
      // Pas de classement cable (tests, ou jalon anterieur a M5) : le match
      // se termine sur un classement neutre, envoye sans la moindre attente.
      this.sendMatchEnd(match, result, NEUTRAL_RATING);
      return;
    }

    void this.settleAndAnnounce(match, result);
  }

  /**
   * Calcule le classement de fin de match, puis l'annonce.
   *
   * Seule methode asynchrone du runtime : tout le reste, du premier tap au
   * dernier, reste synchrone (regle d'or n°1 : le serveur decide, sans
   * attendre, ce qui est jouable). Celle-ci n'intervient qu'apres que le match
   * a deja son vainqueur — rien qu'elle fasse ne peut plus changer une seule
   * regle de jeu, seulement le classement affiche.
   */
  private async settleAndAnnounce(
    match: LiveMatch,
    result: { winner: Seat | null; reason: string },
  ): Promise<void> {
    let outcome: Readonly<Record<Seat, SeatRatingOutcome>>;
    try {
      outcome = await this.ratingSettlement!.settle({
        mode: match.mode,
        seats: match.seats,
        result,
        atMs: this.clock.now(),
        // Un fantome n'a pas de classement a recevoir, et son adversaire n'en
        // recoit que la moitie (docs/05). Le calcul reste entier au module
        // `rating` : on lui dit seulement qui n'etait pas la.
        ghost: match.ghost,
      });
    } catch (cause) {
      this.log?.warn(
        `classement de fin de match indisponible pour ${match.matchId} : ${describeCause(cause)}`,
      );
      outcome = NEUTRAL_RATING;
    }

    this.sendMatchEnd(match, result, outcome);
  }

  private sendMatchEnd(
    match: LiveMatch,
    result: { winner: Seat | null; reason: string },
    outcome: Readonly<Record<Seat, SeatRatingOutcome>>,
  ): void {
    for (const seat of SEATS) {
      const seatOutcome = outcome[seat];
      this.notifier.send(match.seats[seat], 'match:end', {
        matchId: match.matchId,
        winner: result.winner,
        reason: result.reason as ServerMessage<'match:end'>['reason'],
        rating: {
          before: seatOutcome.before.leaguePoints,
          after: seatOutcome.after.leaguePoints,
          leagueBefore: seatOutcome.before.league,
          leagueAfter: seatOutcome.after.league,
        },
        rewards: seatOutcome.rewards,
      });
    }
  }

  /**
   * Ecrit le match acheve.
   *
   * L'ecriture ne bloque pas la fin de partie : les joueurs ont deja recu leur
   * resultat, et une base lente ne doit pas retarder leur ecran de victoire.
   * Un echec est journalise par l'adaptateur, jamais propage ici — perdre un
   * enregistrement est regrettable, faire tomber le serveur l'est davantage.
   */
  private persist(match: LiveMatch, result: { winner: Seat | null; reason: string }): void {
    if (this.repository === null) return;

    const record: MatchRecord = {
      matchId: match.matchId,
      seed: match.seed,
      mode: match.mode,
      rulesVersion: RULES_VERSION,
      contentVersion: CONTENT_VERSION,
      // `null` au siege d'un fantome : `MatchSeat.playerId` pointe sur `Player`
      // (docs/04), et l'identifiant synthetique d'un siege fantome n'y existe
      // pas. C'est `ghost.sourcePlayerId`, via `ghostOfId`, qui dit de qui le
      // rejeu provenait.
      seats: {
        a: match.ghost?.seat === 'a' ? null : match.seats.a,
        b: match.ghost?.seat === 'b' ? null : match.seats.b,
      },
      ghost: match.ghost,
      winner: result.winner,
      reason: result.reason,
      startedAtMs: match.startedAtMs,
      endedAtMs: this.clock.now(),
      rounds: match.state.history.map((round, index) => ({ round: index + 1, result: round })),
      events: match.journal.map((entry) => ({ atMs: entry.atMs, event: entry.event })),
      rejectedEvents: { ...match.rejected },
      droppedEvents: { ...match.dropped },
      impossibleTaps: { ...match.impossibleTaps },
    };

    void this.repository.save(record).catch(() => {
      // L'adaptateur journalise le detail.
    });
  }

  /**
   * Conserve ce match comme modele de fantome (docs/05 § « Fantomes »).
   *
   * Trois conditions, et chacune ferme un defaut precis :
   *
   * - **`RANKED` seulement**, parce que c'est ce que le document demande — et
   *   parce qu'une invitation entre amis n'est pas un echantillon de niveau ;
   * - **aucun siege fantome**, sans quoi un rejeu servirait de modele au
   *   suivant : le niveau de la file derivererait de copie en copie, en
   *   s'eloignant un peu plus a chaque fois de ce qu'un humain joue vraiment ;
   * - **au moins une manche jouee**, sinon on enregistrerait un adversaire qui
   *   ne fait rien — c'est-a-dire une victoire offerte a qui le croisera.
   *
   * Comme l'ecriture du match, elle ne bloque pas la fin de partie et un echec
   * ne remonte jamais : perdre un enregistrement ne coute qu'un fantome de
   * moins dans la reserve.
   */
  /**
   * Remonte aux defis quotidiens ce que ce match a rapporte.
   *
   * La VICTOIRE s'ajoute ici, une seule fois : la compter par manche paierait
   * trois fois le defi « gagner un duel » pour une seule partie, et le
   * paierait meme a qui a perdu deux manches sur trois.
   *
   * Sans attendre, et sans jamais remonter d'erreur : un defi non compte est
   * un desagrement, un `match:end` retarde par une base lente est une panne
   * visible pour deux joueurs.
   */
  private recordChallenges(match: LiveMatch, result: { winner: Seat | null }): void {
    if (this.challengeTracker === null) return;

    for (const seat of SEATS) {
      // Un fantome n'est personne : il n'a pas de defis a avancer.
      if (match.ghost?.seat === seat) continue;

      const contribution = mergeContributions(match.contributions[seat], {
        ...emptyContribution(),
        wins: result.winner === seat ? 1 : 0,
      });

      void this.challengeTracker
        .recordMatch(match.seats[seat], contribution)
        .catch((cause: unknown) => {
          this.log?.warn(`defis non comptes pour ${match.seats[seat]} : ${describeCause(cause)}`);
        });
    }
  }

  private recordGhost(match: LiveMatch): void {
    if (this.ghostRecorder === null) return;
    if (match.mode !== 'RANKED' || match.ghost !== null) return;
    if (match.ghostTrace.a.length === 0 && match.ghostTrace.b.length === 0) return;

    void this.ghostRecorder
      .record({
        matchId: match.matchId,
        seats: match.seats,
        rounds: { a: [...match.ghostTrace.a], b: [...match.ghostTrace.b] },
        atMs: this.clock.now(),
      })
      .catch((cause: unknown) => {
        this.log?.warn(
          `enregistrement de fantome impossible pour ${match.matchId} : ${describeCause(cause)}`,
        );
      });
  }
}
