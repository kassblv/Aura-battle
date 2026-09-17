import { beforeEach, describe, expect, it } from 'vitest';
import { generateDeviceSecret, hashSecret } from '../domain/credentials.js';
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
  private next = 1;

  findByDeviceHash(deviceHash: string): Promise<PlayerRecord | null> {
    return Promise.resolve(this.byDeviceHash.get(deviceHash) ?? null);
  }

  findById(playerId: string): Promise<PlayerRecord | null> {
    return Promise.resolve(this.byId.get(playerId) ?? null);
  }

  createWithDeviceIdentity(input: {
    deviceHash: string;
    displayName: string;
  }): Promise<PlayerRecord> {
    const player: PlayerRecord = { id: `p_${String(this.next++)}`, displayName: input.displayName };
    this.byDeviceHash.set(input.deviceHash, player);
    this.byId.set(player.id, player);
    return Promise.resolve(player);
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
      expiresAt: input.expiresAt,
      revokedAt: null,
      replacedBy: null,
    };
    this.rows.set(row.id, row);
    return Promise.resolve(row);
  }

  markRotated(id: string, replacedByHash: string, at: Date): Promise<void> {
    const row = this.rows.get(id);
    if (row !== undefined) {
      this.rows.set(id, { ...row, replacedBy: replacedByHash, revokedAt: at });
    }
    return Promise.resolve();
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
  sign(payload: { playerId: string }): Promise<string> {
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

  it('permet plusieurs renouvellements successifs', async () => {
    let session = await service.authenticateDevice(generateDeviceSecret());
    for (let i = 0; i < 3; i += 1) {
      session = await service.refresh(session.refreshToken);
    }
    expect(session.player.id).toBe('p_1');
  });
});
