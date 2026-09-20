import {
  DEVICE_SECRET_PATTERN,
  generateDisplayName,
  generateRefreshToken,
  hashSecret,
} from '../domain/credentials.js';
import { DeviceIdentityConflictError } from '../domain/ports.js';
import type {
  AccessTokenSigner,
  Clock,
  PlayerRecord,
  PlayerRepository,
  RefreshTokenRepository,
} from '../domain/ports.js';

/**
 * Ouverture et renouvellement d'une session (jalon M3).
 *
 * Deux cas d'usage seulement : se presenter avec un secret d'appareil, et
 * echanger un jeton de rafraichissement contre un nouveau couple.
 */

export interface Session {
  readonly accessToken: string;
  readonly refreshToken: string;
  /** Duree de vie du jeton d'acces, en secondes. */
  readonly expiresIn: number;
  readonly player: { readonly id: string; readonly displayName: string; readonly guest: boolean };
}

export type SessionFailure =
  | 'DEVICE_ALREADY_LINKED'
  | 'INVALID_DEVICE_SECRET'
  | 'INVALID_REFRESH_TOKEN'
  | 'REFRESH_TOKEN_EXPIRED'
  | 'REFRESH_TOKEN_REUSED';

export class SessionError extends Error {
  constructor(readonly reason: SessionFailure) {
    super(reason);
    this.name = 'SessionError';
  }
}

export interface SessionDependencies {
  readonly players: PlayerRepository;
  readonly refreshTokens: RefreshTokenRepository;
  readonly signer: AccessTokenSigner;
  readonly clock: Clock;
  readonly accessTtlSeconds: number;
  readonly refreshTtlSeconds: number;
}

export class SessionService {
  constructor(private readonly deps: SessionDependencies) {}

  /**
   * Ouvre une session a partir d'un secret d'appareil.
   *
   * Le premier appel cree le joueur. Les suivants le retrouvent — c'est tout ce
   * qu'il faut pour jouer sans inscription.
   */
  async authenticateDevice(deviceSecret: string): Promise<Session> {
    if (!DEVICE_SECRET_PATTERN.test(deviceSecret)) {
      // Refuser la forme protege d'un client qui enverrait un identifiant
      // d'appareil devinable la ou on attend un secret tire au hasard.
      throw new SessionError('INVALID_DEVICE_SECRET');
    }

    const deviceHash = hashSecret(deviceSecret);
    const existing = await this.deps.players.findByDeviceHash(deviceHash);
    const player = existing ?? (await this.createOrAdopt(deviceHash));

    if (existing !== null) {
      await this.deps.players.touchLastSeen(player.id);
    }

    return this.issue(player);
  }

  /**
   * Cree le joueur de cet appareil, ou adopte celui qu'un appel concurrent
   * vient de creer.
   *
   * Deux onglets ouverts ensemble, un double appui au lancement ou un simple
   * reessai reseau suffisent : les deux appels ne trouvent rien et creent en
   * meme temps. Perdre cette course n'est pas une faute du client, c'est le
   * comportement normal du protocole d'ouverture de session — le perdant
   * repart donc du joueur du gagnant. Une collision sans joueur a retrouver,
   * en revanche, est une vraie anomalie : elle remonte.
   */
  private async createOrAdopt(deviceHash: string): Promise<PlayerRecord> {
    try {
      return await this.deps.players.createWithDeviceIdentity({
        deviceHash,
        displayName: generateDisplayName(),
      });
    } catch (cause) {
      if (!(cause instanceof DeviceIdentityConflictError)) {
        throw cause;
      }
      const winner = await this.deps.players.findByDeviceHash(deviceHash);
      if (winner === null) {
        throw cause;
      }
      return winner;
    }
  }

  /**
   * Echange un jeton de rafraichissement contre un nouveau couple.
   *
   * Rotation systematique : le jeton presente est consomme. Un jeton **deja
   * consomme** qui revient signale une copie en circulation — on revoque alors
   * toute la famille du joueur plutot que de servir le voleur et la victime en
   * parallele.
   */
  async refresh(refreshToken: string): Promise<Session> {
    const tokenHash = hashSecret(refreshToken);
    const stored = await this.deps.refreshTokens.findByHash(tokenHash);
    const now = this.deps.clock.now();

    if (stored === null) {
      throw new SessionError('INVALID_REFRESH_TOKEN');
    }

    if (stored.revokedAt !== null || stored.replacedBy !== null) {
      await this.deps.refreshTokens.revokeAllForPlayer(stored.playerId, now);
      throw new SessionError('REFRESH_TOKEN_REUSED');
    }

    if (stored.expiresAt.getTime() <= now.getTime()) {
      throw new SessionError('REFRESH_TOKEN_EXPIRED');
    }

    // Le jeton porte l'identifiant du joueur, pas son appareil : c'est par la
    // qu'il faut le retrouver. Un jeton valide dont le joueur a disparu est un
    // jeton a refuser, pas un joueur a inventer.
    const player = await this.deps.players.findById(stored.playerId);
    if (player === null) {
      throw new SessionError('INVALID_REFRESH_TOKEN');
    }

    const session = await this.issue(player);
    await this.deps.refreshTokens.markRotated(stored.id, hashSecret(session.refreshToken), now);
    return session;
  }

  /**
   * Rattache l'appareil courant a un joueur deja identifie.
   *
   * Appele juste apres qu'un code de recuperation a ete presente. Sans lui, le
   * navigateur garderait son propre secret d'appareil et rouvrirait le compte
   * invite local au rechargement suivant : le joueur verrait son compte
   * revenir, puis disparaitre.
   */
  async linkDevice(playerId: string, deviceSecret: string): Promise<void> {
    if (!DEVICE_SECRET_PATTERN.test(deviceSecret)) {
      throw new SessionError('INVALID_DEVICE_SECRET');
    }
    const player = await this.deps.players.findById(playerId);
    if (player === null) throw new SessionError('INVALID_DEVICE_SECRET');

    try {
      await this.deps.players.linkDeviceIdentity(player.id, hashSecret(deviceSecret));
    } catch (cause) {
      if (cause instanceof DeviceIdentityConflictError) {
        // Ce secret appartient deja a quelqu'un — au compte invite que ce
        // navigateur vient d'abandonner, le plus souvent. Le client en tire un
        // neuf avant d'appeler ; si la collision arrive quand meme, on refuse
        // plutot que de rattacher l'appareil d'un autre joueur.
        throw new SessionError('DEVICE_ALREADY_LINKED');
      }
      throw cause;
    }
  }

  /**
   * Ouvre une session pour un joueur deja identifie autrement.
   *
   * Sert au code de recuperation : la preuve a ete faite ailleurs, il ne reste
   * qu'a emettre. Le couple de jetons passe par `issue`, comme toutes les
   * sessions — un second point d'emission serait un second endroit ou la
   * rotation, l'expiration et la revocation pourraient diverger.
   */
  async openForPlayer(playerId: string): Promise<Session> {
    const player = await this.deps.players.findById(playerId);
    if (player === null) throw new SessionError('INVALID_DEVICE_SECRET');
    await this.deps.players.touchLastSeen(player.id);
    return this.issue(player);
  }

  private async issue(player: {
    readonly id: string;
    readonly displayName: string;
  }): Promise<Session> {
    const now = this.deps.clock.now();
    const refreshToken = generateRefreshToken();

    await this.deps.refreshTokens.create({
      playerId: player.id,
      tokenHash: hashSecret(refreshToken),
      expiresAt: new Date(now.getTime() + this.deps.refreshTtlSeconds * 1_000),
    });

    return {
      accessToken: await this.deps.signer.sign({ playerId: player.id }),
      refreshToken,
      expiresIn: this.deps.accessTtlSeconds,
      player: { id: player.id, displayName: player.displayName, guest: true },
    };
  }
}
