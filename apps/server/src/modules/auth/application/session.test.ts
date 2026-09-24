import { beforeEach, describe, expect, it } from 'vitest';
import { generateDeviceSecret, hashSecret } from '../domain/credentials.js';
import { DeviceIdentityConflictError } from '../domain/ports.js';
import type {
  AccessTokenSigner,
  Clock,
  PlayerRecord,
  PlayerRepository,
  RefreshTokenRecord,
  RefreshTokenRepository,
} from '../domain/ports.js';
import { SessionError, SessionService } from './session.js';

/**
 * Doubles en memoire : le domaine ne connait pas Prisma, donc ces cas d'usage
 * se testent sans base de donnees et sans attendre l'expiration reelle d'un
 * jeton. C'est tout l'interet de l'architecture hexagonale.
 */
class FakePlayers implements PlayerRepository {
  readonly byDeviceHash = new Map<string, PlayerRecord>();
  readonly byId = new Map<string, PlayerRecord>();
  touched: string[] = [];
  /** Panne a injecter au prochain `createWithDeviceIdentity`. */
  createFailure: Error | null = null;
  private next = 1;

  findByDeviceHash(deviceHash: string): Promise<PlayerRecord | null> {
    return Promise.resolve(this.byDeviceHash.get(deviceHash) ?? null);
  }

  findById(playerId: string): Promise<PlayerRecord | null> {
    return Promise.resolve(this.byId.get(playerId) ?? null);
  }

  rename(playerId: string, displayName: string): Promise<PlayerRecord | null> {
    const player = this.byId.get(playerId);
    if (player === undefined) return Promise.resolve(null);
    const renamed = { ...player, displayName };
    this.byId.set(playerId, renamed);
    return Promise.resolve(renamed);
  }

  createWithDeviceIdentity(input: {
    deviceHash: string;
    displayName: string;
  }): Promise<PlayerRecord> {
    if (this.createFailure !== null) {
      const failure = this.createFailure;
      this.createFailure = null;
      return Promise.reject(failure);
    }
    // La base porte une contrainte d'unicite sur (provider, subject) : un double
    // qui accepterait deux joueurs pour un meme appareil laisserait passer
    // exactement le bug qu'on cherche a couvrir.
    if (this.byDeviceHash.has(input.deviceHash)) {
      return Promise.reject(new DeviceIdentityConflictError());
    }
    const player: PlayerRecord = { id: `p_${String(this.next++)}`, displayName: input.displayName };
    this.byDeviceHash.set(input.deviceHash, player);
    this.byId.set(player.id, player);
    return Promise.resolve(player);
  }

  linkDeviceIdentity(playerId: string, deviceHash: string): Promise<void> {
    // Meme contrainte que la base : (provider, subject) est unique.
    if (this.byDeviceHash.has(deviceHash)) {
      return Promise.reject(new DeviceIdentityConflictError());
    }
    const player = this.byId.get(playerId);
    if (player === undefined) return Promise.reject(new Error('joueur inconnu'));
    this.byDeviceHash.set(deviceHash, player);
    this.linked.push({ playerId, deviceHash });
    return Promise.resolve();
  }

  readonly linked: { playerId: string; deviceHash: string }[] = [];
  /** `Player.credentialsVersion`, par joueur (0 si jamais change). */
  readonly versions = new Map<string, number>();
  /** Jetons crees par `joinDevice`, comme la vraie transaction les cree. */
  readonly joinedTokens: string[] = [];

  async joinDevice(input: {
    playerId: string;
    deviceHash: string;
    expectedVersion: number;
    refreshTokenHash: string;
    expiresAt: Date;
  }): Promise<
    | { outcome: 'JOINED'; player: PlayerRecord; credentialsVersion: number; detached: number }
    | { outcome: 'STALE' }
    | { outcome: 'DEVICE_TAKEN' }
  > {
    const player = this.byId.get(input.playerId);
    const version = this.versions.get(input.playerId) ?? 0;
    if (player === undefined || version !== input.expectedVersion) return { outcome: 'STALE' };
    if (this.byDeviceHash.has(input.deviceHash)) return { outcome: 'DEVICE_TAKEN' };
    await this.linkDeviceIdentity(player.id, input.deviceHash);
    this.joinedTokens.push(input.refreshTokenHash);
    return { outcome: 'JOINED', player, credentialsVersion: version, detached: 0 };
  }

  touchLastSeen(playerId: string): Promise<void> {
    this.touched.push(playerId);
    return Promise.resolve();
  }
}

class FakeRefreshTokens implements RefreshTokenRepository {
  readonly rows = new Map<string, RefreshTokenRecord>();
  private next = 1;

  findByHash(tokenHash: string): Promise<RefreshTokenRecord | null> {
    return Promise.resolve([...this.rows.values()].find((r) => r.tokenHash === tokenHash) ?? null);
  }

  create(input: {
    playerId: string;
    tokenHash: string;
    expiresAt: Date;
  }): Promise<RefreshTokenRecord> {
    const row: RefreshTokenRecord = {
      id: `rt_${String(this.next++)}`,
      playerId: input.playerId,
      tokenHash: input.tokenHash,
      createdAt: new Date(0),
      expiresAt: input.expiresAt,
      revokedAt: null,
      replacedBy: null,
      credentialsVersion: this.credentialsVersion,
    };
    this.rows.set(row.id, row);
    return Promise.resolve(row);
  }

  /** `Player.credentialsVersion` : un changement de mot de passe l'incremente. */
  credentialsVersion = 0;

  async rotate(input: {
    id: string;
    playerId: string;
    credentialsVersion: number;
    replacedByHash: string;
    expiresAt: Date;
    at: Date;
  }): Promise<
    | { readonly outcome: 'ROTATED'; readonly credentialsVersion: number }
    | { readonly outcome: 'REUSED' }
    | { readonly outcome: 'STALE' }
  > {
    const row = this.rows.get(input.id);
    if (row?.revokedAt !== null || row.replacedBy !== null) return { outcome: 'REUSED' };
    this.rows.set(input.id, { ...row, replacedBy: input.replacedByHash, revokedAt: input.at });
    if (input.credentialsVersion !== this.credentialsVersion) return { outcome: 'STALE' };
    const created = await this.create({
      playerId: input.playerId,
      tokenHash: input.replacedByHash,
      expiresAt: input.expiresAt,
    });
    return { outcome: 'ROTATED', credentialsVersion: created.credentialsVersion };
  }

  revokeAllForPlayer(playerId: string, at: Date): Promise<void> {
    for (const [id, row] of this.rows) {
      if (row.playerId === playerId && row.revokedAt === null) {
        this.rows.set(id, { ...row, revokedAt: at });
      }
    }
    return Promise.resolve();
  }
}

class StubSigner implements AccessTokenSigner {
  readonly signed: { playerId: string; credentialsVersion: number }[] = [];
  sign(payload: { playerId: string; credentialsVersion: number }): Promise<string> {
    this.signed.push(payload);
    return Promise.resolve(`jwt.${payload.playerId}`);
  }
}

class MovableClock implements Clock {
  constructor(private current = new Date('2026-09-17T10:00:00Z')) {}
  now(): Date {
    return this.current;
  }
  advanceSeconds(seconds: number): void {
    this.current = new Date(this.current.getTime() + seconds * 1_000);
  }
}

let players: FakePlayers;
let refreshTokens: FakeRefreshTokens;
let clock: MovableClock;
let service: SessionService;

beforeEach(() => {
  players = new FakePlayers();
  refreshTokens = new FakeRefreshTokens();
  clock = new MovableClock();
  service = new SessionService({
    players,
    refreshTokens,
    signer: new StubSigner(),
    clock,
    accessTtlSeconds: 900,
    refreshTtlSeconds: 2_592_000,
  });
});

describe('authenticateDevice — jouer sans inscription', () => {
  it('cree un joueur au premier appel', async () => {
    const session = await service.authenticateDevice(generateDeviceSecret());
    expect(session.player.id).toBe('p_1');
    expect(session.player.guest).toBe(true);
    expect(session.player.displayName).toMatch(/^Invite \d{4}$/);
  });

  it('retrouve le meme joueur au second appel', async () => {
    const secret = generateDeviceSecret();
    const premiere = await service.authenticateDevice(secret);
    const seconde = await service.authenticateDevice(secret);
    expect(seconde.player.id).toBe(premiere.player.id);
    expect(seconde.player.displayName).toBe(premiere.player.displayName);
  });

  it('distingue deux appareils differents', async () => {
    const a = await service.authenticateDevice(generateDeviceSecret());
    const b = await service.authenticateDevice(generateDeviceSecret());
    expect(a.player.id).not.toBe(b.player.id);
  });

  it('ne stocke jamais le secret en clair', async () => {
    const secret = generateDeviceSecret();
    await service.authenticateDevice(secret);
    expect([...players.byDeviceHash.keys()]).toEqual([hashSecret(secret)]);
    expect([...players.byDeviceHash.keys()]).not.toContain(secret);
  });

  it('note le passage d un joueur connu', async () => {
    const secret = generateDeviceSecret();
    await service.authenticateDevice(secret);
    await service.authenticateDevice(secret);
    expect(players.touched).toEqual(['p_1']);
  });

  it('rend le meme joueur a deux appels concurrents du meme appareil', async () => {
    // Deux onglets, ou un double appui au lancement : les deux appels ne
    // trouvent rien et creent en meme temps. Le perdant de la course doit
    // repartir du joueur que le gagnant vient de creer.
    const secret = generateDeviceSecret();
    const [a, b] = await Promise.all([
      service.authenticateDevice(secret),
      service.authenticateDevice(secret),
    ]);

    expect(b.player.id).toBe(a.player.id);
    expect(players.byId.size).toBe(1);
  });

  it('remonte une panne de creation qui n est pas une collision', async () => {
    players.createFailure = new Error('base indisponible');
    await expect(service.authenticateDevice(generateDeviceSecret())).rejects.toThrow(
      'base indisponible',
    );
  });

  it('remonte la collision si le joueur reste introuvable ensuite', async () => {
    // Une collision sans joueur a retrouver n'est plus une course : c'est une
    // anomalie, et l'avaler rendrait une session sans joueur.
    players.createFailure = new DeviceIdentityConflictError();
    await expect(service.authenticateDevice(generateDeviceSecret())).rejects.toThrow(
      DeviceIdentityConflictError,
    );
  });

  it('refuse un secret qui n en est pas un', async () => {
    // Un identifiant d'appareil devinable ne doit pas passer pour un secret.
    await expect(service.authenticateDevice('iphone-de-kassim')).rejects.toThrow(SessionError);
    await expect(service.authenticateDevice('')).rejects.toThrow(SessionError);
    await expect(service.authenticateDevice('ABCDEF'.repeat(11))).rejects.toThrow(SessionError);
  });

  it('delivre un jeton d acces et un jeton de rafraichissement', async () => {
    const session = await service.authenticateDevice(generateDeviceSecret());
    expect(session.accessToken).toBe('jwt.p_1');
    expect(session.refreshToken.length).toBeGreaterThan(40);
    expect(session.expiresIn).toBe(900);
  });

  it('ne stocke jamais le jeton de rafraichissement en clair', async () => {
    const session = await service.authenticateDevice(generateDeviceSecret());
    const stocke = [...refreshTokens.rows.values()].map((row) => row.tokenHash);
    expect(stocke).toEqual([hashSecret(session.refreshToken)]);
    expect(stocke).not.toContain(session.refreshToken);
  });
});

describe('refresh — renouveler une session', () => {
  it('rend un nouveau couple de jetons', async () => {
    const ouverte = await service.authenticateDevice(generateDeviceSecret());
    const renouvelee = await service.refresh(ouverte.refreshToken);
    expect(renouvelee.player.id).toBe(ouverte.player.id);
    expect(renouvelee.refreshToken).not.toBe(ouverte.refreshToken);
  });

  it('conserve le nom du joueur', async () => {
    const ouverte = await service.authenticateDevice(generateDeviceSecret());
    const renouvelee = await service.refresh(ouverte.refreshToken);
    expect(renouvelee.player.displayName).toBe(ouverte.player.displayName);
  });

  it('refuse un jeton inconnu', async () => {
    await expect(service.refresh('jeton-invente')).rejects.toThrow(SessionError);
  });

  it('refuse un jeton expire', async () => {
    const ouverte = await service.authenticateDevice(generateDeviceSecret());
    clock.advanceSeconds(2_592_001);
    await expect(service.refresh(ouverte.refreshToken)).rejects.toThrow(/EXPIRED/);
  });

  it('detecte le rejeu et revoque toute la famille', async () => {
    // Un jeton deja consomme qui revient signale une copie en circulation.
    const ouverte = await service.authenticateDevice(generateDeviceSecret());
    const renouvelee = await service.refresh(ouverte.refreshToken);

    await expect(service.refresh(ouverte.refreshToken)).rejects.toThrow(/REUSED/);

    // La session du voleur comme celle de la victime sont coupees.
    await expect(service.refresh(renouvelee.refreshToken)).rejects.toThrow(SessionError);
  });

  /* Relecture de securite (C) : un jeton cree avant un changement de mot de passe. */
  it('refuse de renouveler un jeton anterieur a un changement de mot de passe', async () => {
    const ouverte = await service.authenticateDevice(generateDeviceSecret());
    refreshTokens.credentialsVersion = 1;
    await expect(service.refresh(ouverte.refreshToken)).rejects.toThrow(/INVALID_REFRESH_TOKEN/);
  });

  it('signe le jeton d acces avec la version des identifiants du jeton renouvele', async () => {
    const signer = new StubSigner();
    const sut = new SessionService({
      players,
      refreshTokens,
      signer,
      clock,
      accessTtlSeconds: 900,
      refreshTtlSeconds: 2_592_000,
    });
    refreshTokens.credentialsVersion = 4;
    const ouverte = await sut.authenticateDevice(generateDeviceSecret());
    await sut.refresh(ouverte.refreshToken);
    expect(signer.signed.map((s) => s.credentialsVersion)).toEqual([4, 4]);
  });

  it('permet plusieurs renouvellements successifs', async () => {
    let session = await service.authenticateDevice(generateDeviceSecret());
    for (let i = 0; i < 3; i += 1) {
      session = await service.refresh(session.refreshToken);
    }
    expect(session.player.id).toBe('p_1');
  });
});

describe('joinWithDevice', () => {
  /*
    Presenter un code ou un mot de passe ouvre une session, et le navigateur
    garde SON secret d'appareil : sans rattachement, le rechargement suivant
    rouvrirait le compte invite local. Le rattachement se fait dans le meme
    geste que l'ouverture — il AJOUTE une identite, rien n'est deplace.
  */
  it('rattache l appareil et ouvre la session du compte', async () => {
    const opened = await service.authenticateDevice(generateDeviceSecret());
    const secret = generateDeviceSecret();

    const session = await service.joinWithDevice(opened.player.id, 0, secret);

    expect(session.player.id).toBe(opened.player.id);
    expect(players.linked).toEqual([
      { playerId: opened.player.id, deviceHash: hashSecret(secret) },
    ]);
    // Le jeton est cree PAR la transaction de rattachement, pas a cote.
    expect(players.joinedTokens).toEqual([hashSecret(session.refreshToken)]);
    // Et le nouveau secret ouvre bien le MEME compte au prochain lancement.
    const again = await service.authenticateDevice(secret);
    expect(again.player.id).toBe(opened.player.id);
  });

  /*
    Quatrieme relecture (B1) : la preuve portait sur un secret qui a change
    depuis. Rien n'est rattache, aucun jeton n'est emis.
  */
  it('refuse si la version des identifiants a change depuis la preuve', async () => {
    const opened = await service.authenticateDevice(generateDeviceSecret());
    players.versions.set(opened.player.id, 1);

    await expect(
      service.joinWithDevice(opened.player.id, 0, generateDeviceSecret()),
    ).rejects.toMatchObject({ reason: 'CREDENTIALS_CHANGED' });
    expect(players.linked).toHaveLength(0);
    expect(players.joinedTokens).toHaveLength(0);
  });

  it('refuse un secret qui n a pas la bonne forme', async () => {
    const opened = await service.authenticateDevice(generateDeviceSecret());
    await expect(service.joinWithDevice(opened.player.id, 0, 'trop-court')).rejects.toMatchObject({
      reason: 'INVALID_DEVICE_SECRET',
    });
    expect(players.linked).toHaveLength(0);
  });

  /*
    Ce secret peut deja appartenir a quelqu'un. Le client en tire un neuf a
    chaque essai ; si la collision arrive quand meme, elle remonte plutot que
    de rattacher l'appareil d'un autre joueur.
  */
  it('remonte une collision plutot que de voler une identite', async () => {
    const pris = generateDeviceSecret();
    await service.authenticateDevice(pris);
    const autre = await service.authenticateDevice(generateDeviceSecret());

    await expect(service.joinWithDevice(autre.player.id, 0, pris)).rejects.toMatchObject({
      reason: 'DEVICE_ALREADY_LINKED',
    });
  });

  it('refuse de rattacher a un joueur qui n existe pas', async () => {
    await expect(
      service.joinWithDevice('p_inconnu', 0, generateDeviceSecret()),
    ).rejects.toBeInstanceOf(SessionError);
  });
});
