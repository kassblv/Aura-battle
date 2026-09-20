import { Inject, Injectable } from '@nestjs/common';
import { serializeServerMessage, type ServerMessage, type ServerMessageName } from '@aura/protocol';
import type { Socket } from 'socket.io';
import { PinoLoggerService } from '../../../shared/logger.js';
import { MessageMetrics } from '../../../shared/metrics.js';
import type { PresenceLeagueCache } from '../../rating/domain/ports.js';
import { UNKNOWN_PLAYER_NAME } from '../domain/directory.js';
import type { MatchNotifier } from '../domain/ports.js';

/**
 * Ligue montree quand aucune n'est connue — a la connexion d'un joueur qui
 * n'a jamais joue de match classe. Doit rester en phase avec
 * `STARTING_RATING.league` (`rating/domain/rating.ts`) : c'est litteralement
 * le meme joueur, sans ligne de classement.
 */
export const DEFAULT_LEAGUE = 'sans_aura';

/**
 * Registre des sessions connectees, et envoi des messages.
 *
 * Il tient trois choses par joueur : sa socket, son nom affiche, et la garantie
 * que **chaque message est valide avant d'etre emis**. C'est la moitie du
 * garde-fou qu'on oublie : valider l'entrant protege le serveur, valider le
 * sortant protege les joueurs. Un message qui ne passe pas son propre schema
 * n'est pas envoye — c'est un defaut du serveur, et il est journalise comme tel.
 *
 * **Pourquoi le nom vit ici.** C'est une propriete de la session, pas du match :
 * le resoudre a la connexion — ou l'on attend deja l'authentification — permet a
 * l'ouverture d'un match de rester **entierement synchrone**. Sans cela, il
 * faudrait lire la base entre le controle des sieges et leur reservation, et
 * cette attente suffit a laisser deux messages de la meme salve asseoir un
 * joueur a deux matchs.
 */

/**
 * Une session connectee : sa socket, et ce qu'on affichera d'elle.
 *
 * `league` n'est pas `readonly` : contrairement au nom, elle change en cours
 * de session — a chaque match classe joue (`setLeague`) — sans qu'il y ait de
 * nouvelle connexion pour la reresoudre.
 */
interface Session {
  readonly socket: Socket;
  readonly displayName: string;
  league: string;
}

@Injectable()
export class SocketNotifier implements MatchNotifier, PresenceLeagueCache {
  private readonly sessions = new Map<string, Session>();

  constructor(
    @Inject(PinoLoggerService) private readonly logger: PinoLoggerService,
    /**
     * Chronometre du sortant (jalon M7).
     *
     * Le serveur envoie plus de messages qu'il n'en recoit — un `round:result`
     * par siege, une annonce par phase et par siege — et chacun repasse par son
     * schema avant de partir. Ce travail n'appartient a la fenetre d'aucun
     * message entrant : sans compteur propre, il est invisible dans un relevé
     * de charge alors qu'il occupe la meme boucle.
     */
    @Inject(MessageMetrics) private readonly metrics: MessageMetrics,
  ) {}

  /**
   * Enregistre la socket d'un joueur et **ferme la precedente**.
   *
   * Sans cette fermeture, l'ancienne socket reste authentifiee et pleinement
   * operante : elle ne recoit plus rien, mais elle peut toujours emettre. Un
   * joueur ouvrant cent sockets avec un seul jeton disposerait alors de cent
   * fois le budget de debit, chacune ayant son propre seau a jetons. `docs/03`
   * prevoit de toute facon que le client ferme proprement avant de se
   * reconnecter.
   */
  register(
    playerId: string,
    socket: Socket,
    displayName: string,
    league: string = DEFAULT_LEAGUE,
  ): void {
    const previous = this.sessions.get(playerId);
    this.sessions.set(playerId, { socket, displayName, league });
    if (previous !== undefined && previous.socket !== socket) {
      previous.socket.disconnect(true);
    }
  }

  /**
   * Retire une socket, et **dit si c'etait bien la socket courante**.
   *
   * Ce booleen n'est pas un detail de confort : `register` ferme la socket
   * precedente, et Socket.IO emet `disconnect` synchroniquement dans la meme
   * pile. L'ancien handler se declenche donc **pendant** une reconnexion
   * parfaitement legitime. Si l'appelant en tire un abandon ou une sortie de
   * file, chaque reconnexion punit le joueur qui revient. Repondre `false` ici
   * est ce qui permet a l'appelant de faire la difference, au lieu de dependre
   * de l'ordre de deux lignes.
   */
  unregister(playerId: string, socket: Socket): boolean {
    if (this.sessions.get(playerId)?.socket !== socket) return false;
    this.sessions.delete(playerId);
    return true;
  }

  /** Nombre de sessions connectees, pour la sonde de charge (jalon M7). */
  get liveSessions(): number {
    return this.sessions.size;
  }

  isConnected(playerId: string): boolean {
    return this.sessions.has(playerId);
  }

  /**
   * Nom affiche d'un joueur connecte, resolu a sa connexion.
   *
   * Synchrone par construction : c'est ce qui permet d'annoncer un match sans
   * la moindre attente. Un joueur inconnu — deconnecte entre-temps — retombe
   * sur `UNKNOWN_PLAYER_NAME` plutot que de faire echouer l'ouverture : un nom
   * manquant ne vaut pas un duel annule.
   */
  displayNameOf(playerId: string): string {
    return this.sessions.get(playerId)?.displayName ?? UNKNOWN_PLAYER_NAME;
  }

  /**
   * Ligue d'un joueur connecte, resolue a sa connexion puis rafraichie a
   * chaque match classe (`setLeague`).
   *
   * Synchrone, pour la meme raison que `displayNameOf` : c'est ce qui permet
   * a `MatchOpener` d'annoncer la ligue de l'adversaire dans `match:found`
   * sans jamais attendre entre le controle des sieges et leur reservation.
   */
  leagueOf(playerId: string): string {
    return this.sessions.get(playerId)?.league ?? DEFAULT_LEAGUE;
  }

  /**
   * Met a jour la ligue en cache, apres un match classe (`PresenceLeagueCache`).
   *
   * Sans ce rafraichissement, la ligue lue a la connexion se perimerait a
   * chaque match classe joue dans la meme session, et `match:found` finirait
   * par annoncer une ligue vieille de vingt manches. Un joueur deconnecte
   * entre la fin du match et cet appel n'a plus de session a mettre a jour —
   * ce n'est pas une erreur, sa ligue sera lue a jour a sa prochaine connexion.
   */
  setLeague(playerId: string, league: string): void {
    const session = this.sessions.get(playerId);
    if (session === undefined) return;
    session.league = league;
  }

  send<N extends ServerMessageName>(playerId: string, name: N, payload: ServerMessage<N>): void {
    /**
     * Le chemin non mesure ne passe pas par le chronometre du tout.
     *
     * `observeSync` rend deja la main immediatement quand la mesure est
     * eteinte, mais l'appeler alloue la fermeture qu'on lui passe — deux par
     * message sortant, en permanence. La branche explicite repete trois
     * lignes, et c'est le seul endroit du serveur ou cela se justifie : il est
     * traverse plus souvent qu'aucun autre.
     */
    if (!this.metrics.enabled) {
      const checked = serializeServerMessage(name, payload);
      if (!checked.success) {
        this.reportInvalid(name, checked.error);
        return;
      }
      // Un joueur deconnecte n'est pas une erreur : le match continue sans lui,
      // les actions par defaut s'appliquent, et il reprendra sur `match:rejoin`.
      this.sessions.get(playerId)?.socket.emit(name, checked.data);
      return;
    }

    const checked = this.metrics.observeSync('outbound:validate', () =>
      serializeServerMessage(name, payload),
    );
    if (!checked.success) {
      this.reportInvalid(name, checked.error);
      return;
    }

    const socket = this.sessions.get(playerId)?.socket;
    if (socket === undefined) return;
    this.metrics.observeSync('outbound:emit', () => socket.emit(name, checked.data));
  }

  /**
   * Un message sortant qui ne passe pas son propre schema.
   *
   * C'est un defaut du **serveur**, jamais du joueur : il est journalise comme
   * tel, et le message n'est pas envoye.
   */
  private reportInvalid(name: string, error: string): void {
    this.logger.error(
      new Error(`message sortant « ${name} » invalide : ${error}`),
      undefined,
      'SocketNotifier',
    );
  }
}
