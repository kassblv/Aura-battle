import {
  DEVICE_SECRET_PATTERN,
  generateDisplayName,
  generateRefreshToken,
  hashSecret,
} from '../domain/credentials.js';
import type {
  AccessTokenSigner,
  Clock,
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
    const player =
      existing ??
      (await this.deps.players.createWithDeviceIdentity({
        deviceHash,
        displayName: generateDisplayName(),
      }));

    if (existing !== null) {
      await this.deps.players.touchLastSeen(player.id);
    }

    return this.issue(player);
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
