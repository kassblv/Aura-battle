/**
 * Ports du module d'authentification (architecture hexagonale, docs/02).
 *
 * Le domaine ne connait ni Prisma ni l'horloge systeme : il les recoit. C'est ce
 * qui permet de tester l'expiration d'un jeton ou la detection de rejeu sans
 * base de donnees et sans attendre trente jours.
 */

export interface PlayerRecord {
  readonly id: string;
  readonly displayName: string;
}

export interface RefreshTokenRecord {
  readonly id: string;
  readonly playerId: string;
  readonly tokenHash: string;
  readonly expiresAt: Date;
  readonly revokedAt: Date | null;
  readonly replacedBy: string | null;
}

export interface PlayerRepository {
  /** Trouve le joueur portant cette identite d'appareil, ou `null`. */
  findByDeviceHash(deviceHash: string): Promise<PlayerRecord | null>;
  /** Trouve un joueur par son identifiant. */
  findById(playerId: string): Promise<PlayerRecord | null>;
  /** Cree un joueur et son identite d'appareil, en une seule transaction. */
  createWithDeviceIdentity(input: {
    readonly deviceHash: string;
    readonly displayName: string;
  }): Promise<PlayerRecord>;
  /** Change le nom affiche. Rend `null` si le joueur n existe plus. */
  rename(playerId: string, displayName: string): Promise<PlayerRecord | null>;
  touchLastSeen(playerId: string): Promise<void>;
}

export interface RefreshTokenRepository {
  findByHash(tokenHash: string): Promise<RefreshTokenRecord | null>;
  create(input: {
    readonly playerId: string;
    readonly tokenHash: string;
    readonly expiresAt: Date;
  }): Promise<RefreshTokenRecord>;
  /** Marque un jeton comme consomme et note son remplacant. */
  markRotated(id: string, replacedByHash: string, at: Date): Promise<void>;
  /** Revoque tous les jetons vivants d'un joueur. */
  revokeAllForPlayer(playerId: string, at: Date): Promise<void>;
}

/** Signature et verification des jetons d'acces. */
export interface AccessTokenSigner {
  sign(payload: { readonly playerId: string }): Promise<string>;
}

/** L'horloge est un port : le temps est une entree, pas une globale. */
export interface Clock {
  now(): Date;
}
