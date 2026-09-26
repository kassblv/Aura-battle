import {
  DEVICE_SECRET_PATTERN,
  generateDisplayName,
  generateRefreshToken,
  hashSecret,
} from '../domain/credentials.js';
import type { AppLog } from '../../../shared/log-port.js';
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
  /** La version des identifiants a change entre la preuve et le rattachement. */
  | 'CREDENTIALS_CHANGED'
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
  readonly log?: AppLog;
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

    /*
      Consommer et remplacer en un seul geste atomique (ADR 0013). Lire puis
      marquer laissait une fenetre : deux renouvellements concurrents
      reussissaient tous deux, et un changement de mot de passe survenu entre
      la lecture et l'ecriture laissait naitre un jeton neuf apres la
      revocation — l'intrus chasse restait dedans.
    */
    const replacement = generateRefreshToken();
    const rotated = await this.deps.refreshTokens.rotate({
      id: stored.id,
      playerId: player.id,
      credentialsVersion: stored.credentialsVersion,
      replacedByHash: hashSecret(replacement),
      expiresAt: this.refreshExpiry(now),
      at: now,
    });
    if (rotated.outcome === 'REUSED') {
      await this.deps.refreshTokens.revokeAllForPlayer(stored.playerId, now);
      throw new SessionError('REFRESH_TOKEN_REUSED');
    }
    if (rotated.outcome === 'STALE') {
      // Le mot de passe a change depuis : ce jeton appartient a une session
      // que le changement devait fermer.
      throw new SessionError('INVALID_REFRESH_TOKEN');
    }
    return this.sessionFor(player, replacement, rotated.credentialsVersion);
  }

  /**
   * Rattache l'appareil qui vient de faire sa preuve et ouvre sa session, en
   * un seul geste atomique (ADR 0013).
   *
   * `provenVersion` est la version des identifiants lue AVEC la preuve (code
   * ou mot de passe). Si un changement de mot de passe s'est glisse entre la
   * preuve et ce rattachement, la preuve portait sur l'ancien secret : on
   * refuse, et rien n'est ecrit — ni appareil, ni jeton.
   */
  async joinWithDevice(
    playerId: string,
    provenVersion: number,
    deviceSecret: string,
  ): Promise<Session> {
    if (!DEVICE_SECRET_PATTERN.test(deviceSecret)) {
      throw new SessionError('INVALID_DEVICE_SECRET');
    }
    const refreshToken = generateRefreshToken();
    const joined = await this.deps.players.joinDevice({
      playerId,
      deviceHash: hashSecret(deviceSecret),
      expectedVersion: provenVersion,
      refreshTokenHash: hashSecret(refreshToken),
      expiresAt: this.refreshExpiry(this.deps.clock.now()),
    });
    if (joined.outcome === 'STALE') throw new SessionError('CREDENTIALS_CHANGED');
    if (joined.outcome === 'DEVICE_TAKEN') {
      // Ce secret appartient deja a quelqu'un. Le client en tire un neuf a
      // chaque essai ; plutot refuser que rattacher l'appareil d'un autre.
      throw new SessionError('DEVICE_ALREADY_LINKED');
    }
    if (joined.detached > 0) {
      // Un appareil detache rouvrira un compte invite a son prochain
      // lancement : on veut pouvoir l'expliquer si un joueur s'en etonne.
      this.deps.log?.warn(
        `plafond d appareils atteint : ${String(joined.detached)} appareil(s) detache(s)`,
      );
    }
    return this.sessionFor(joined.player, refreshToken, joined.credentialsVersion);
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
    const refreshToken = generateRefreshToken();
    const stored = await this.deps.refreshTokens.create({
      playerId: player.id,
      tokenHash: hashSecret(refreshToken),
      expiresAt: this.refreshExpiry(this.deps.clock.now()),
    });
    // La version lue AVEC la creation du jeton, sous verrou : le jeton d'acces
    // signe ensuite porte la meme, meme si la signature a lieu hors transaction.
    return this.sessionFor(player, refreshToken, stored.credentialsVersion);
  }

  private refreshExpiry(now: Date): Date {
    return new Date(now.getTime() + this.deps.refreshTtlSeconds * 1_000);
  }

  /** Le couple de jetons, une fois le jeton de rafraichissement range. */
  private async sessionFor(
    player: { readonly id: string; readonly displayName: string },
    refreshToken: string,
    credentialsVersion: number,
  ): Promise<Session> {
    return {
      accessToken: await this.deps.signer.sign({ playerId: player.id, credentialsVersion }),
      refreshToken,
      expiresIn: this.deps.accessTtlSeconds,
      player: { id: player.id, displayName: player.displayName, guest: true },
    };
  }
}
