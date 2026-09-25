import { randomUUID } from 'node:crypto';
import { CONTENT_VERSION } from '@aura/content';
import { PROTOCOL_VERSION } from '@aura/protocol';
import { RULES_VERSION, type Seat } from '@aura/rules';
import { describeCause } from '../../../shared/describe-cause.js';
import type { AppLog } from '../../../shared/log-port.js';
import type { MatchClock, MatchNotifier } from '../domain/ports.js';
import { rulesVariantFor } from '../domain/rules-variant.js';
import type { MatchSeats, SeatWearing } from './match-runtime.js';

/**
 * Ouverture d'un match, **chemin unique et entierement synchrone**
 * (docs/03-pvp-protocol.md).
 *
 * Invitation et file d'attente passent par ici, et c'est tout l'interet : deux
 * chemins d'ouverture separes divergent toujours — l'un finit par annoncer le
 * bon nom d'adversaire, l'autre non, l'un verifie que les sieges sont libres,
 * l'autre l'oublie. Ajouter demain la revanche ou le fantome, c'est appeler
 * cette methode, pas la recopier.
 *
 * **Aucune attente, nulle part.** Ce n'est pas un choix de style, c'est le
 * correctif : `await` entre le controle des sieges et leur reservation suffit a
 * laisser deux messages de la meme salve — Socket.IO delivre chaque paquet dans
 * son propre tour de boucle — asseoir le meme joueur a deux matchs. Le nom
 * affiche est donc resolu a la connexion, pas ici, et la sortie de file part
 * **apres** l'ouverture, sans qu'on l'attende.
 */

/** Ce que l'ouverture attend du runtime : asseoir deux joueurs, ou refuser. */
export interface MatchStarter {
  /** Vrai si ce joueur occupe deja un siege. */
  isBusy(playerId: string): boolean;
  /** Faux si le match existe deja ou si un siege est occupe. */
  createMatch(input: {
    matchId: string;
    seed: string;
    seats: MatchSeats;
    mode?: MatchMode;
    ghost?: {
      seat: Seat;
      mmr: number;
      sourcePlayerId: string;
      displayName: string;
      league: string;
    } | null;
    /** Variante de regles du match ; absente, les regles normales. */
    rulesVariant?: string;
  }): boolean;
  /**
   * Enregistre ce que porte un siege, apres la creation.
   *
   * Separe de `createMatch` a dessein : ses trois appelants n'ont pas tous
   * une apparence a fournir, et un match qui l'ignore reste un match qui
   * marche — chacun y porte alors l'effet offert de son palier.
   */
  setWearing(matchId: string, seat: Seat, wearing: SeatWearing): void;
  /** Arme le compte a rebours d'abandon d'un joueur absent. */
  notePlayerDisconnected(playerId: string): void;
}

/**
 * Qui est connecte, sous quel nom, et dans quelle ligue.
 *
 * Les trois reponses sont synchrones : elles viennent du registre des
 * sessions, rempli a la connexion et rafraichi a chaque match classe pour la
 * ligue (`PresenceLeagueCache`, module `rating`). Un port plutot que le
 * notifier lui-meme, parce que « a qui j'envoie » et « qui est la » sont deux
 * questions distinctes.
 */
export interface PlayerPresence {
  isConnected(playerId: string): boolean;
  displayNameOf(playerId: string): string;
  /** Ligue publique du joueur (docs/05 « MMR et ligues » : la ligue, pas le MMR, est publique). */
  leagueOf(playerId: string): string;
  /**
   * Ce que le joueur porte, resolu a sa connexion.
   *
   * Synchrone pour la meme raison que le nom et la ligue : l'ouverture ne peut
   * rien attendre entre le controle des sieges et leur reservation. Un joueur
   * dont on ne sait rien porte l'effet offert de son palier, comme tout le
   * monde avant la boutique — une apparence manquante ne vaut pas un duel
   * annule.
   */
  wearingOf(playerId: string): SeatWearing;
}

/**
 * Sortie de file d'attente.
 *
 * Un joueur qui commence un match ne doit plus figurer dans la file, quel que
 * soit le chemin par lequel le match est arrive : sinon le worker l'apparie une
 * seconde fois, et son nouvel adversaire heritera d'un forfait. Le retrait est
 * donc declenche par l'**ouverture**, pas par l'appariement — une invitation
 * acceptee pendant l'attente laisserait sinon son ticket derriere elle.
 *
 * **Ce port ne va que dans un sens, et c'est delibere.** Remettre quelqu'un en
 * file n'appartient pas a l'ouverture : elle n'a jamais le ticket en main — le
 * tour d'appariement l'a deja reclame — et elle ne peut rien attendre. C'est
 * donc l'appelant qui repose ce qu'il a pris quand `open` rend `null` (voir
 * `QueueWorker.requeue`).
 */
export interface QueueEviction {
  leave(playerId: string): Promise<void>;
}

export type MatchMode = 'RANKED' | 'CASUAL' | 'INVITE';

/**
 * Siege tenu par le rejeu d'un enregistrement (docs/05 § « Fantomes »).
 *
 * L'ouverture **sait** qu'elle assoit un fantome, et c'est delibere : c'est
 * elle qui envoie `match:found`, donc elle seule peut porter le drapeau
 * `ghost`. Le declarer ici plutot que de le deviner a l'identifiant du siege
 * garde la regle lisible — un joueur n'apprend jamais qu'il affronte un
 * enregistrement par un effet de bord.
 *
 * `displayName` et `league` viennent de l'appelant, deja resolus : l'ouverture
 * ne sait pas lire un classement, et n'a pas le droit d'attendre.
 */
export interface GhostSeatRequest {
  readonly seat: Seat;
  /** Joueur dont provient l'enregistrement. Ecrit en base, jamais envoye. */
  readonly sourcePlayerId: string;
  readonly mmr: number;
  readonly recordingId: string;
  readonly displayName: string;
  readonly league: string;
}

export interface OpenRequest {
  /** Siege `a`. Par convention, l'hote de l'invitation ou le plus ancien en file. */
  readonly playerA: string;
  readonly playerB: string;
  readonly mode: MatchMode;
  /** Absent : les deux sieges sont des personnes. */
  readonly ghost?: GhostSeatRequest;
}

export class MatchOpener {
  constructor(
    private readonly runtime: MatchStarter,
    private readonly notifier: MatchNotifier,
    private readonly presence: PlayerPresence,
    private readonly queue: QueueEviction | null = null,
    private readonly log: AppLog | null = null,
    /**
     * Heure serveur, pour la variante de la semaine (M10). Absente, tout se
     * joue en regles normales — ce que faisait le jeu avant les evenements.
     */
    private readonly clock: MatchClock | null = null,
  ) {}

  /**
   * Ouvre le match, ou rend `null` si un siege n'est pas libre.
   *
   * L'ordre est fixe par deux contraintes, et aucune n'est negociable.
   *
   * `createMatch` n'est pas « reserver les sieges », c'est **demarrer la
   * partie** : il annonce la phase d'intro synchroniquement, donc `round:intro`
   * part dans la foulee. `match:found` doit donc etre envoye avant, faute de
   * quoi le client recoit une manche portant un `matchId` qu'il ne connait pas
   * encore, avec un compte a rebours qui tourne pendant qu'il l'ignore.
   *
   * Mais annoncer un match qu'on ne pourra pas ouvrir serait pire : le client
   * basculerait sur une arene dont le serveur ne sait rien. D'ou le controle des
   * sieges juste avant l'annonce — et comme rien ici ne suspend, ce controle ne
   * peut pas etre dementi par ce qui suit. Il n'y a pas non plus de reservation
   * a liberer en cas d'echec : c'est l'autre piege de l'ordre inverse, ou un
   * echec pendant une lecture en base laisserait les deux joueurs « occupes »
   * a vie.
   *
   * **`null` veut dire « reprends ce que tu m'avais confie ».** Quand l'appel
   * vient du worker, les deux tickets ont deja quitte la file — c'est le tour
   * d'appariement qui les a reclames, avant d'arriver ici. Les remettre en
   * file est donc a la charge de l'appelant, seul a les avoir encore en main,
   * et seul a pouvoir attendre pour les y reposer. Sans cela le refus est
   * **silencieux** : les deux joueurs restent devant un ecran de recherche que
   * plus aucun tour n'alimente.
   */
  open(request: OpenRequest): string | null {
    const seats: MatchSeats = { a: request.playerA, b: request.playerB };

    /**
     * Personne ne joue contre soi-meme.
     *
     * Un joueur assis aux deux sieges controle les deux choix et gagne a coup
     * sur, et la partie s'enregistre comme un match classe. `createMatch` le
     * refuse deja, mais tout au fond : ici, on echoue **avant** d'avoir
     * annonce le match a qui que ce soit. `invites.ts` a sa propre garde — une
     * garde du CHEMIN ; celle-ci vaut pour tous les appelants, present et a
     * venir, ce que revendique le docblock de ce fichier.
     */
    if (seats.a === seats.b) {
      this.log?.warn(`ouverture refusee : ${seats.a} ne peut pas s'asseoir en face de lui-meme`);
      return null;
    }

    if (this.runtime.isBusy(seats.a) || this.runtime.isBusy(seats.b)) return null;

    const matchId = `m_${randomUUID()}`;
    const seed = randomUUID();
    const ghost = request.ghost;
    /*
      Decidee UNE fois, ici : l'annonce et le runtime lisent la meme valeur. Un
      fantome de partie rapide la recoit aussi — il rejoue ses choix sous les
      regles de CE match, que son adversaire voit annoncees.
    */
    const rulesVariant =
      this.clock === null ? 'normal' : rulesVariantFor(request.mode, this.clock.now());

    for (const seat of ['a', 'b'] as const satisfies readonly Seat[]) {
      // Rien a annoncer a un fantome : il n'y a personne au bout, et
      // `GhostDirector` n'a pas besoin de savoir contre qui il joue — il ne
      // reagit pas a son adversaire (docs/05).
      if (seat === ghost?.seat) continue;

      const playerId = seats[seat];
      const opponentId = seat === 'a' ? seats.b : seats.a;
      const facingGhost = ghost !== undefined && ghost.seat !== seat;
      this.notifier.send(playerId, 'match:found', {
        matchId,
        seat,
        // Le nom ET la ligue de l'ADVERSAIRE, jamais les siens (docs/05 :
        // seule la ligue est publique, le MMR ne l'est pas).
        opponent: {
          displayName: facingGhost ? ghost.displayName : this.presence.displayNameOf(opponentId),
          league: facingGhost ? ghost.league : this.presence.leagueOf(opponentId),
          // L'apparence PUBLIQUE de l'adversaire, figee pour le match. Ni ses
          // danses par mouvement ni ses effets : ceux-la ne se montrent
          // qu'avec le coup joue, dans `round:result`.
          cosmetics: facingGhost ? {} : { ...this.presence.wearingOf(opponentId).look },
        },
        protocolVersion: PROTOCOL_VERSION,
        rulesVersion: RULES_VERSION,
        contentVersion: CONTENT_VERSION,
        /**
         * **Le drapeau d'honnetete** (docs/05 § « Fantomes »).
         *
         * Il part dans le tout premier message du match, avant la moindre
         * manche, et le client l'affiche. Un fantome qui passerait pour un
         * humain serait un mensonge du serveur, pas un detail d'affichage :
         * c'est ici, et nulle part ailleurs, que cette promesse se tient.
         */
        ghost: facingGhost,
        // Omise en regles normales : c'est ce qu'un client suppose sans elle.
        ...(rulesVariant === 'normal' ? {} : { rulesVariant }),
      });
    }

    if (
      !this.runtime.createMatch({
        matchId,
        seed,
        seats,
        mode: request.mode,
        rulesVariant,
        ghost:
          ghost === undefined
            ? null
            : {
                seat: ghost.seat,
                mmr: ghost.mmr,
                sourcePlayerId: ghost.sourcePlayerId,
                // Le nom et la ligue annonces : le runtime les rappellera a une
                // reprise apres reconnexion, ou aucune session ne repondra.
                displayName: ghost.displayName,
                league: ghost.league,
              },
      })
    ) {
      // Inatteignable sans collision d'identifiant : les sieges viennent d'etre
      // verifies et rien n'a pu s'intercaler. Si cela arrivait, c'est un defaut
      // du serveur et il doit se voir.
      this.log?.warn(`ouverture refusee pour ${matchId} apres annonce aux joueurs`);
      return null;
    }

    /*
      Ce que chaque siege porte, fige pour la duree du match.

      Resolu ici plutot que dans `createMatch` : deux de ses trois appelants
      n'ont que faire de l'apparence, et un match sans cette information reste
      un match qui marche. C'est le SERVEUR qui la detient — elle arrivait
      avant par `choice:lock`, declaree par le client et relayee sans controle
      de possession.

      APRES `createMatch`, jamais avant : le runtime ignore un match qu'il ne
      connait pas. Pose trop tot, aucun skin n'atteignait la revelation.
      Rien n'est perdu a attendre : l'apparence ne sert qu'a `round:result`.
    */
    for (const seat of ['a', 'b'] as const satisfies readonly Seat[]) {
      this.runtime.setWearing(matchId, seat, this.presence.wearingOf(seats[seat]));
    }

    /**
     * Un siege deja vide a l'arrivee.
     *
     * `notePlayerDisconnected` ne se declenche que sur le **front** descendant
     * de la deconnexion. Un joueur parti juste avant l'ouverture n'a donc
     * arme aucun minuteur — le match n'existait pas encore — et aucun evenement
     * futur ne le fera : son adversaire subirait trois manches d'actions par
     * defaut au lieu d'un forfait en quarante-cinq secondes.
     */
    for (const seat of ['a', 'b'] as const satisfies readonly Seat[]) {
      /**
       * Un fantome n'est jamais « parti » : il n'a pas de socket a perdre.
       *
       * Sans cette exception, l'ouverture armerait pour lui le compte a rebours
       * d'abandon — `isConnected` repond non, faute de session — et le match
       * s'acheverait sur un forfait au bout de quarante-cinq secondes, donc une
       * victoire offerte a son adversaire, au milieu de la deuxieme manche.
       */
      if (seat === ghost?.seat) continue;
      if (!this.presence.isConnected(seats[seat])) {
        this.runtime.notePlayerDisconnected(seats[seat]);
      }
    }

    /**
     * Sortie de file, **apres** et sans attendre.
     *
     * Le match est deja ouvert : l'attendre n'apporterait rien et remettrait
     * une suspension dans un chemin qui doit n'en avoir aucune. Rien ne depend
     * de sa rapidite — un joueur assis est deja ecarte de l'appariement par le
     * controle de disponibilite du worker, qui lit `isBusy` de facon synchrone.
     */
    // Un fantome n'a jamais fait la queue : rien a l'en sortir.
    if (ghost?.seat !== 'a') this.evict(seats.a);
    if (ghost?.seat !== 'b') this.evict(seats.b);

    return matchId;
  }

  /** Sortie de file au mieux : une file muette n'empeche pas de jouer. */
  private evict(playerId: string): void {
    void this.queue?.leave(playerId).catch((cause: unknown) => {
      this.log?.warn(`sortie de file impossible pour ${playerId} : ${describeCause(cause)}`);
    });
  }
}
