import { Inject, Injectable } from '@nestjs/common';
import {
  ConnectedSocket,
  MessageBody,
  SubscribeMessage,
  WebSocketGateway,
  type OnGatewayConnection,
} from '@nestjs/websockets';
import {
  isClientMessageName,
  parseClientMessage,
  serializeServerMessage,
  type ClientMessage,
  type ServerMessage,
  type ServerMessageName,
} from '@aura/protocol';
import type { Seat } from '@aura/rules';
import type { Socket } from 'socket.io';
import { describeCause } from '../../../shared/describe-cause.js';
import { PinoLoggerService } from '../../../shared/logger.js';
import { TokenBucket } from '../../../shared/rate-limit.js';
import { SocketAuthenticator } from '../../auth/application/socket-auth.js';
import {
  PLAYER_DIRECTORY,
  UNKNOWN_PLAYER_NAME,
  type PlayerDirectory,
} from '../domain/directory.js';
import { MatchmakingQueue } from '../../matchmaking/application/queue.service.js';
import { RATING_DIRECTORY, type RatingDirectory } from '../../rating/domain/ports.js';
import { InviteService } from '../application/invites.js';
import { MatchOpener } from '../application/match-opener.js';
import { MatchRuntime } from '../application/match-runtime.js';
import { DEFAULT_LEAGUE, SocketNotifier } from './socket-notifier.js';

/**
 * Passerelle temps reel (docs/03-pvp-protocol.md).
 *
 * Trois filtres, dans cet ordre, avant qu'un message n'atteigne la moindre
 * regle de jeu : le handshake est authentifie, le debit est borne, la charge
 * utile est validee par son schema. Ce qui ne passe pas les trois n'existe pas.
 */

/**
 * Reglage de la limite de debit.
 *
 * Un joueur honnete envoie ses taps toutes les 500 ms, plus un verrouillage de
 * choix et des ping : tres en dessous de 15 messages par seconde. La capacite
 * de 30 laisse passer une rafale courte — reconnexion, renvoi apres coupure —
 * sans ouvrir la porte a une inondation.
 */
const RATE_LIMIT = { capacity: 30, refillPerSecond: 15 } as const;

/**
 * Nombre de refus de debit signales a un client avant qu'on ne se taise.
 *
 * Repondre `error` a chaque paquet refuse **amplifie** l'inondation au lieu de
 * l'amortir : l'attaquant paie un message, le serveur en paie deux. On previent
 * une fois, puis silence ; un client honnete a compris des le premier.
 */
const MAX_RATE_LIMIT_REPLIES = 1;

/** Donnees attachees a une socket authentifiee. */
interface SocketState {
  playerId: string;
  bucket: TokenBucket;
  /** Refus de debit deja signales a ce client. */
  rateLimitReplies: number;
}

/**
 * Le nom affiche est une propriete de la **session**, pas du match.
 *
 * Le resoudre ici — dans le seul endroit qui attend deja, pour
 * l'authentification — est ce qui permet a l'ouverture d'un match de rester
 * entierement synchrone. Une lecture en base entre le controle des sieges et
 * leur reservation suffirait a laisser deux `invite:join` de la meme salve
 * asseoir un joueur a deux matchs.
 *
 * Le cout passe d'une requete par ouverture de match — au moment precis ou deux
 * joueurs attendent — a une requete par connexion, sur cle primaire.
 */

@Injectable()
@WebSocketGateway({ cors: { origin: true }, transports: ['websocket'] })
export class MatchGateway implements OnGatewayConnection {
  constructor(
    @Inject(SocketAuthenticator) private readonly auth: SocketAuthenticator,
    @Inject(PinoLoggerService) private readonly logger: PinoLoggerService,
    @Inject(MatchRuntime) private readonly runtime: MatchRuntime,
    @Inject(InviteService) private readonly invites: InviteService,
    @Inject(SocketNotifier) private readonly notifier: SocketNotifier,
    @Inject(MatchOpener) private readonly opener: MatchOpener,
    @Inject(MatchmakingQueue) private readonly queue: MatchmakingQueue,
    @Inject(PLAYER_DIRECTORY) private readonly directory: PlayerDirectory,
    @Inject(RATING_DIRECTORY) private readonly ratings: RatingDirectory,
  ) {}

  /** Identifiant du joueur derriere une socket authentifiee. */
  private playerOf(socket: Socket): string {
    return (socket.data as SocketState).playerId;
  }

  /**
   * Retrouve le siege d'un joueur dans un match, ou refuse.
   *
   * Un message portant le `matchId` d'un match ou l'on n'est pas assis est
   * exactement le genre de tentative qu'il faut couper net.
   */
  private seatIn(socket: Socket, matchId: string): Seat | null {
    const seat = this.runtime.seatOf(matchId, this.playerOf(socket));
    if (seat === null) {
      this.emit(socket, 'error', {
        code: 'NOT_IN_MATCH',
        message: 'match inconnu',
        retryable: false,
      });
    }
    return seat;
  }

  /**
   * Envoie un message a une socket, **apres validation sortante**.
   *
   * C'est la moitie du garde-fou qu'on oublie : valider l'entrant protege le
   * serveur, valider le sortant protege les joueurs. Un message qui ne passe
   * pas son propre schema n'est pas envoye — il est journalise comme un defaut
   * du serveur, parce que c'en est un.
   */
  emit<N extends ServerMessageName>(socket: Socket, name: N, payload: ServerMessage<N>): boolean {
    const checked = serializeServerMessage(name, payload);
    if (!checked.success) {
      this.logger.error(
        new Error(`message sortant « ${name} » invalide : ${checked.error}`),
        undefined,
        'MatchGateway',
      );
      return false;
    }
    socket.emit(name, checked.data);
    return true;
  }

  /**
   * Nom affiche du joueur, ou le nom de repli.
   *
   * Une lecture ratee ne doit pas empecher de se connecter : le joueur verra
   * « Adversaire » au lieu de son nom, ce qui est infiniment preferable a une
   * socket refusee parce que Postgres a hoquete.
   */
  private async displayNameOf(playerId: string): Promise<string> {
    try {
      return (await this.directory.displayNames([playerId])).get(playerId) ?? UNKNOWN_PLAYER_NAME;
    } catch (cause) {
      this.logger.warn(
        `annuaire indisponible a la connexion de ${playerId} : ${describeCause(cause)}`,
        'MatchGateway',
      );
      return UNKNOWN_PLAYER_NAME;
    }
  }

  /**
   * Ligue du joueur, ou la ligue de depart.
   *
   * Meme raison que `displayNameOf` : lue une fois a la connexion pour que
   * `MatchOpener` puisse l'annoncer a l'adversaire sans jamais attendre
   * (`PlayerPresence.leagueOf`). Rafraichie ensuite par chaque match classe
   * (`SocketNotifier.setLeague`, port `PresenceLeagueCache`) — cette lecture
   * ne sert donc qu'une fois par session, au pire.
   */
  private async leagueOf(playerId: string): Promise<string> {
    try {
      return (await this.ratings.leaguesOf([playerId], Date.now())).get(playerId) ?? DEFAULT_LEAGUE;
    } catch (cause) {
      this.logger.warn(
        `classement indisponible a la connexion de ${playerId} : ${describeCause(cause)}`,
        'MatchGateway',
      );
      return DEFAULT_LEAGUE;
    }
  }

  async handleConnection(socket: Socket): Promise<void> {
    const result = await this.auth.authenticate(socket.handshake.auth);
    if (!result.ok) {
      this.emit(socket, 'error', {
        code: result.code,
        message: result.message,
        retryable: result.code === 'UNAUTHORIZED',
      });
      socket.disconnect(true);
      return;
    }

    const state: SocketState = {
      playerId: result.playerId,
      bucket: new TokenBucket(RATE_LIMIT),
      rateLimitReplies: 0,
    };
    socket.data = state;

    socket.on('disconnect', () => {
      /**
       * Une fermeture ne vaut deconnexion que si c'etait la socket **courante**.
       *
       * `register` ferme la socket precedente, et Socket.IO emet `disconnect`
       * synchroniquement dans la meme pile : ce handler se declenche donc au
       * beau milieu d'une reconnexion parfaitement legitime. Armer un abandon
       * et vider la file a ce moment-la punirait le joueur qui revient. Cela
       * fonctionnait jusqu'ici par chance d'ordonnancement — la ligne suivante
       * annulait le minuteur juste apres ; on ne depend plus de cet ordre.
       */
      if (!this.notifier.unregister(state.playerId, socket)) return;

      // Le match continue sans lui ; il a quarante-cinq secondes pour revenir.
      this.runtime.notePlayerDisconnected(state.playerId);

      /**
       * Le ticket quitte la file, mais n'est pas detruit.
       *
       * Un ticket qui reste appariable sans son joueur offre a son adversaire
       * un `match:found` contre personne, puis un forfait : il doit sortir de
       * la file sur-le-champ — le worker ecarte deja les absents a chaque
       * tour, ceci ferme la fenetre de 500 ms entre les deux.
       *
       * Le detruire serait excessif pour autant. `docs/03` demande au client de
       * **fermer proprement sa socket** quand l'application passe en
       * arriere-plan, et accorde 45 s pour revenir dans un match : la file n'a
       * aucune raison d'etre plus severe. Le ticket est donc gare le temps de
       * la meme grace, et `resume` le remet en jeu si le joueur revient.
       */
      void this.queue.park(state.playerId, Date.now()).catch((cause: unknown) => {
        this.logger.warn(
          `sortie de file impossible pour ${state.playerId} : ${describeCause(cause)}`,
          'MatchGateway',
        );
      });
    });

    // Un seul point de passage pour tout l'entrant : la limite de debit et la
    // validation de schema s'appliquent a chaque evenement, y compris ceux
    // qu'on ajoutera plus tard. Rien ne peut les contourner par oubli.
    socket.use((packet, next) => {
      // Socket.IO type un paquet comme un tuple ouvert : on le lit sans
      // supposer qu'il porte bien deux elements.
      const event = String(packet[0]);
      const payload: unknown = packet[1];

      if (!state.bucket.tryConsume(Date.now())) {
        // On previent une fois, puis on se tait : repondre a chaque paquet
        // refuse ferait du serveur le complice de l'inondation.
        if (state.rateLimitReplies < MAX_RATE_LIMIT_REPLIES) {
          state.rateLimitReplies += 1;
          this.emit(socket, 'error', {
            code: 'RATE_LIMITED',
            message: 'trop de messages',
            retryable: true,
          });
        }
        return;
      }
      state.rateLimitReplies = 0;

      if (!isClientMessageName(event)) {
        this.emit(socket, 'error', {
          code: 'INVALID_PAYLOAD',
          message: 'evenement inconnu',
          retryable: false,
        });
        return;
      }

      // Socket.IO livre `undefined` quand le client emet sans argument ; les
      // schemas sans champ attendent un objet vide.
      const parsed = parseClientMessage(event, payload ?? {});
      if (!parsed.success) {
        this.logger.debug(`charge invalide sur « ${event} » : ${parsed.error}`, 'MatchGateway');
        this.emit(socket, 'error', {
          code: 'INVALID_PAYLOAD',
          message: 'charge utile invalide',
          retryable: false,
        });
        return;
      }

      next();
    });

    /**
     * Le nom et la ligue sont lus **apres** avoir pose le filtre entrant, en
     * parallele — deux lectures independantes, aucune raison de les serialiser.
     *
     * C'est la seule attente de cette methode, et rien ne doit pouvoir en
     * profiter : tant que `socket.use` n'est pas installe, un client presse
     * enverrait ses messages sans limite de debit ni validation de schema.
     */
    const [displayName, league] = await Promise.all([
      this.displayNameOf(state.playerId),
      this.leagueOf(state.playerId),
    ]);

    // Parti pendant la lecture : l'enregistrer maintenant laisserait une
    // session fantome que `isConnected` declarerait vivante pour toujours.
    if (!socket.connected) return;

    this.notifier.register(state.playerId, socket, displayName, league);

    // Revenu a temps : le compte a rebours d'abandon est desarme.
    this.runtime.notePlayerReconnected(state.playerId);

    /**
     * Revenu a temps la aussi : sa recherche reprend ou elle s'etait arretee.
     *
     * C'est le serveur qui la relance, pas le client : le client d'aujourd'hui
     * ne renvoie pas `queue:join` en se reconnectant, et son ecran de
     * recherche est toujours affiche. Sans ce rappel, il regarderait un
     * compte a rebours que plus aucun ticket n'alimente.
     *
     * Rien a reprendre pour un joueur en duel : son ticket a quitte la file a
     * l'ouverture du match, et c'est `match:rejoin` qui le fait revenir.
     */
    if (!this.runtime.isBusy(state.playerId)) {
      void this.queue.resume(state.playerId, Date.now()).catch((cause: unknown) => {
        this.logger.warn(
          `reprise de file impossible pour ${state.playerId} : ${describeCause(cause)}`,
          'MatchGateway',
        );
      });
    }

    this.logger.debug(`socket authentifiee pour ${state.playerId}`, 'MatchGateway');
  }

  /**
   * Mesure d'horloge (docs/03).
   *
   * Le client renvoie son propre instant et recoit l'heure serveur : il en
   * deduit son offset et convertit les echeances. On ne compare jamais deux
   * horloges directement.
   */
  @SubscribeMessage('ping')
  ping(@ConnectedSocket() socket: Socket, @MessageBody() body: { t: number }): void {
    this.emit(socket, 'pong', { t: body.t, serverTime: Date.now() });
  }

  /** Cree une invitation et rend le code a dicter a un ami. */
  @SubscribeMessage('invite:create')
  inviteCreate(@ConnectedSocket() socket: Socket): void {
    const invite = this.invites.create(this.playerOf(socket), Date.now());
    this.emit(socket, 'invite:created', invite);
  }

  /**
   * Rejoint une invitation et ouvre le match.
   *
   * L'hote doit etre encore connecte : ouvrir un match dont un siege est vide
   * des le depart ne ferait qu'infliger un forfait a quelqu'un qui est parti.
   */
  @SubscribeMessage('invite:join')
  inviteJoin(
    @ConnectedSocket() socket: Socket,
    @MessageBody() body: ClientMessage<'invite:join'>,
  ): void {
    const guestId = this.playerOf(socket);
    const result = this.invites.join(body.code, guestId, Date.now());
    if (!result.ok) {
      this.emit(socket, 'error', {
        code: result.code,
        message: 'invitation introuvable ou expiree',
        retryable: false,
      });
      return;
    }

    if (!this.notifier.isConnected(result.hostId)) {
      this.emit(socket, 'error', {
        code: 'INVITE_NOT_FOUND',
        message: 'invitation introuvable ou expiree',
        retryable: false,
      });
      return;
    }

    /**
     * Ouverture par le **chemin unique**, celui qu'emprunte aussi la file
     * d'attente (`application/match-opener.ts`). Deux chemins d'ouverture
     * separes divergent toujours : l'un finit par annoncer le bon nom
     * d'adversaire et pas l'autre, l'un verifie que les sieges sont libres et
     * pas l'autre. C'est aussi la que vit l'ordre des messages — `match:found`
     * avant `round:intro` — et la fenetre de course qu'il referme.
     */
    const matchId = this.opener.open({
      playerA: result.hostId,
      playerB: guestId,
      mode: 'INVITE',
    });

    if (matchId === null) {
      this.emit(socket, 'error', {
        code: 'ALREADY_IN_MATCH',
        message: 'un des deux joueurs est deja en match',
        retryable: false,
      });
    }
  }

  /**
   * Entre en file d'attente (docs/05, § « File d'attente »).
   *
   * Seul le mode demande vient du client, et son schema l'a deja valide. Tout
   * le reste — classement, region, anciennete — est etabli par le serveur.
   *
   * Un joueur deja assis a un duel est refuse : l'apparier une seconde fois
   * ferait basculer son client sur une autre arene et lui ferait perdre la
   * partie en cours.
   */
  @SubscribeMessage('queue:join')
  async queueJoin(
    @ConnectedSocket() socket: Socket,
    @MessageBody() body: ClientMessage<'queue:join'>,
  ): Promise<void> {
    const playerId = this.playerOf(socket);

    if (this.runtime.isBusy(playerId)) {
      this.emit(socket, 'error', {
        code: 'ALREADY_IN_MATCH',
        message: 'un duel est deja en cours',
        retryable: false,
      });
      return;
    }

    try {
      await this.queue.join(playerId, body.mode, Date.now());
    } catch (cause) {
      /**
       * Rien n'est renvoye au client, et c'est delibere.
       *
       * L'entree en file est acquittee par le premier `queue:status` : son
       * absence dit deja que la recherche n'a pas demarre. Le protocole n'a
       * pas de code pour « panne interne », et detourner un code existant
       * ferait dire au reseau quelque chose de faux.
       *
       * La cause est **resumee**, pas recopiee : le message d'une erreur de
       * Redis ou de Prisma reproduit les arguments qu'elle a refuses, et la
       * pile avec. C'est la meme politique qu'a l'ecriture d'un match.
       */
      this.logger.error(
        new Error(`entree en file impossible pour ${playerId} : ${describeCause(cause)}`),
        undefined,
        'MatchGateway',
      );
    }
  }

  /**
   * Quitte la file.
   *
   * Aucun accuse en retour : l'arret des `queue:status` dit tout, et le
   * protocole ne prevoit pas de message pour cela. Renvoyer la demande deux
   * fois n'est pas une erreur.
   */
  @SubscribeMessage('queue:leave')
  async queueLeave(@ConnectedSocket() socket: Socket): Promise<void> {
    const playerId = this.playerOf(socket);
    try {
      // `cancel`, pas `leave` : le joueur ne quitte pas seulement la file, il
      // annule sa recherche. La nuance compte quand son ticket vient d'etre
      // reclame par un tour d'appariement — voir `MatchmakingQueue.cancel`.
      await this.queue.cancel(playerId, Date.now());
    } catch (cause) {
      this.logger.warn(
        `sortie de file impossible pour ${playerId} : ${describeCause(cause)}`,
        'MatchGateway',
      );
    }
  }

  /** Reprise apres reconnexion : l'instantane ne contient rien de cache. */
  @SubscribeMessage('match:rejoin')
  rejoin(
    @ConnectedSocket() socket: Socket,
    @MessageBody() body: ClientMessage<'match:rejoin'>,
  ): void {
    const seat = this.seatIn(socket, body.matchId);
    if (seat === null) return;

    const snapshot = this.runtime.snapshotFor(body.matchId, seat);
    if (snapshot !== null) {
      this.emit(socket, 'match:state', this.withOpponent(snapshot, body.matchId, seat));
    }
  }

  /**
   * Rappelle a l'instantane le nom de l'adversaire.
   *
   * Il n'etait annonce que dans `match:found` : une application mobile tuee en
   * arriere-plan — le cas le plus frequent de tous — revenait par
   * `match:rejoin` et finissait la partie contre « Adversaire ».
   *
   * Ce n'est pas une fuite : le destinataire l'avait deja recu a l'ouverture,
   * et l'instantane ne promet rien d'autre que ce qu'il avait le droit de
   * voir. Le champ reste absent si le siege d'en face est introuvable, plutot
   * que d'inventer un nom.
   *
   * **Un fantome se rappelle comme tel** (docs/05) : son siege n'a pas de
   * session, donc le registre ne connait ni son nom ni sa ligue et repondrait
   * « Adversaire ». Le runtime, lui, a garde ce qui a ete annonce a
   * l'ouverture — c'est la meme chose qu'on reaffiche, et `snapshot.ghost` dit
   * deja qu'il s'agit d'un rejeu.
   */
  private withOpponent(
    snapshot: ServerMessage<'match:state'>,
    matchId: string,
    seat: Seat,
  ): ServerMessage<'match:state'> {
    const opponentId = this.runtime.opponentIn(matchId, seat);
    if (opponentId === null) return snapshot;

    const ghost = this.runtime.ghostOpponentIn(matchId, seat);
    return {
      ...snapshot,
      opponent: {
        displayName: ghost?.displayName ?? this.notifier.displayNameOf(opponentId),
        // La vraie ligue de l'adversaire, comme dans `match:found` : « bronze »
        // etait ecrit en dur ici, et n'est meme pas une ligue du jeu (docs/05).
        league: ghost?.league ?? this.notifier.leagueOf(opponentId),
        cosmetics: {},
      },
    };
  }

  /** Assets charges : le client confirme qu'il suit. */
  @SubscribeMessage('match:ready')
  ready(
    @ConnectedSocket() socket: Socket,
    @MessageBody() body: ClientMessage<'match:ready'>,
  ): void {
    const seat = this.seatIn(socket, body.matchId);
    if (seat === null) return;

    const snapshot = this.runtime.snapshotFor(body.matchId, seat);
    if (snapshot !== null) {
      this.emit(socket, 'match:state', this.withOpponent(snapshot, body.matchId, seat));
    }
  }

  @SubscribeMessage('recharge:taps')
  rechargeTaps(
    @ConnectedSocket() socket: Socket,
    @MessageBody() body: ClientMessage<'recharge:taps'>,
  ): void {
    const seat = this.seatIn(socket, body.matchId);
    if (seat === null) return;

    // Un renvoi apres reconnexion ne doit pas compter une seconde fois.
    if (!this.runtime.acceptSeq(body.matchId, seat, body.seq)) return;

    this.runtime.submitTaps(
      body.matchId,
      seat,
      body.taps.map((tap) => ({ atMs: tap.t, orbIndex: tap.orbIndex })),
    );
  }

  @SubscribeMessage('choice:lock')
  choiceLock(
    @ConnectedSocket() socket: Socket,
    @MessageBody() body: ClientMessage<'choice:lock'>,
  ): void {
    const seat = this.seatIn(socket, body.matchId);
    if (seat === null) return;

    if (!this.runtime.acceptSeq(body.matchId, seat, body.seq)) return;

    // Le client envoie l'instant du tap et celui du lancement de charge ; le
    // moteur ne veut que l'ecart, relatif au debut de la charge.
    const timingTapAtMs =
      body.timing.tapAt === null ? null : body.timing.tapAt - body.timing.chargeAt;

    this.runtime.lockChoice(
      body.matchId,
      seat,
      { move: body.move, amplifier: body.amp, useUltimate: body.ult },
      timingTapAtMs,
      body.cosmetic,
    );
  }

  @SubscribeMessage('match:forfeit')
  forfeit(
    @ConnectedSocket() socket: Socket,
    @MessageBody() body: ClientMessage<'match:forfeit'>,
  ): void {
    const seat = this.seatIn(socket, body.matchId);
    if (seat === null) return;
    this.runtime.forfeit(body.matchId, seat);
  }
}
