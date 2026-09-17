import { randomUUID } from 'node:crypto';
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
import { PROTOCOL_VERSION } from '@aura/protocol';
import { RULES_VERSION } from '@aura/rules';
import { CONTENT_VERSION } from '@aura/content';
import type { Socket } from 'socket.io';
import { PinoLoggerService } from '../../../shared/logger.js';
import { TokenBucket } from '../../../shared/rate-limit.js';
import { SocketAuthenticator } from '../../auth/application/socket-auth.js';
import { InviteService } from '../application/invites.js';
import { MatchRuntime } from '../application/match-runtime.js';
import { SocketNotifier } from './socket-notifier.js';

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

/** Donnees attachees a une socket authentifiee. */
interface SocketState {
  playerId: string;
  bucket: TokenBucket;
}

@Injectable()
@WebSocketGateway({ cors: { origin: true }, transports: ['websocket'] })
export class MatchGateway implements OnGatewayConnection {
  constructor(
    @Inject(SocketAuthenticator) private readonly auth: SocketAuthenticator,
    @Inject(PinoLoggerService) private readonly logger: PinoLoggerService,
    @Inject(MatchRuntime) private readonly runtime: MatchRuntime,
    @Inject(InviteService) private readonly invites: InviteService,
    @Inject(SocketNotifier) private readonly notifier: SocketNotifier,
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
    };
    socket.data = state;
    this.notifier.register(state.playerId, socket);
    socket.on('disconnect', () => {
      this.notifier.unregister(state.playerId, socket);
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
        this.emit(socket, 'error', {
          code: 'RATE_LIMITED',
          message: 'trop de messages',
          retryable: true,
        });
        return;
      }

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

    const matchId = `m_${randomUUID()}`;
    const seats = { a: result.hostId, b: guestId } as const;
    const seed = randomUUID();

    for (const [seat, playerId] of Object.entries(seats) as [Seat, string][]) {
      this.notifier.send(playerId, 'match:found', {
        matchId,
        seat,
        opponent: {
          displayName: 'Adversaire',
          league: 'bronze',
          cosmetics: {},
        },
        protocolVersion: PROTOCOL_VERSION,
        rulesVersion: RULES_VERSION,
        contentVersion: CONTENT_VERSION,
        ghost: false,
      });
    }

    this.runtime.createMatch({ matchId, seed, seats });
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
      this.emit(socket, 'match:state', snapshot);
    }
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
      this.emit(socket, 'match:state', snapshot);
    }
  }

  @SubscribeMessage('recharge:taps')
  rechargeTaps(
    @ConnectedSocket() socket: Socket,
    @MessageBody() body: ClientMessage<'recharge:taps'>,
  ): void {
    const seat = this.seatIn(socket, body.matchId);
    if (seat === null) return;

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
