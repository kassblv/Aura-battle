import { adminPlayerDetailSchema, adminPlayerSearchResponseSchema } from '@aura/protocol';
import { levelFor } from '@aura/rules';
import { describe, expect, it } from 'vitest';
import type { AdminAuditEntry } from '../../../shared/admin-audit.js';
import type {
  AdminPlayerDetailRow,
  AdminPlayerRow,
  AdminPlayerStore,
  StoredBan,
} from '../domain/ports.js';
import { AdminPlayersService, InvalidBanError } from './admin-players.service.js';

const NOW = Date.UTC(2026, 8, 26, 12);

class MemoryPlayers implements AdminPlayerStore {
  readonly rows = new Map<string, AdminPlayerDetailRow>();
  readonly audits: AdminAuditEntry[] = [];
  searches: { q: string; limit: number }[] = [];

  search(q: string, limit: number): Promise<readonly AdminPlayerRow[]> {
    this.searches.push({ q, limit });
    return Promise.resolve(
      [...this.rows.values()].filter(
        (row) => row.id === q || row.displayName.toLowerCase().includes(q.toLowerCase()),
      ),
    );
  }

  detail(playerId: string): Promise<AdminPlayerDetailRow | null> {
    return Promise.resolve(this.rows.get(playerId) ?? null);
  }

  setBan(
    playerId: string,
    ban: StoredBan | null,
    audit: (before: StoredBan | null) => AdminAuditEntry,
  ): Promise<boolean> {
    const row = this.rows.get(playerId);
    if (row === undefined) return Promise.resolve(false);
    this.audits.push(audit(row.ban));
    this.rows.set(playerId, { ...row, ban });
    return Promise.resolve(true);
  }
}

const player = (
  id: string,
  overrides: Partial<AdminPlayerDetailRow> = {},
): AdminPlayerDetailRow => ({
  id,
  displayName: `Aura ${id}`,
  createdAt: new Date(NOW - 86_400_000),
  lastSeenAt: new Date(NOW - 60_000),
  ban: null,
  xp: 1_234,
  softCurrency: 50,
  hardCurrency: 3,
  league: 'naissante',
  recentMatches: [
    {
      id: 'm1',
      mode: 'RANKED',
      status: 'ENDED',
      startedAt: new Date(NOW - 3_600_000),
      endReason: 'rounds',
      winnerSeat: 'A',
      seat: 'A',
      isGhost: false,
    },
    {
      id: 'm2',
      mode: 'CASUAL',
      status: 'ENDED',
      startedAt: new Date(NOW - 7_200_000),
      endReason: 'forfeit',
      winnerSeat: 'A',
      seat: 'B',
      isGhost: true,
    },
    {
      id: 'm3',
      mode: 'INVITE',
      status: 'IN_PROGRESS',
      startedAt: new Date(NOW - 9_000_000),
      endReason: null,
      winnerSeat: null,
      seat: 'B',
      isGhost: false,
    },
  ],
  ...overrides,
});

function build() {
  const store = new MemoryPlayers();
  const banned: string[] = [];
  const service = new AdminPlayersService({
    store,
    clock: { now: () => NOW },
    bans: { publish: (playerId) => banned.push(playerId) },
  });
  return { store, service, banned };
}

describe('AdminPlayersService — recherche et fiche', () => {
  it('cherche 20 joueurs au plus et rend le format du contrat', async () => {
    const { store, service } = build();
    store.rows.set('p1', player('p1'));
    store.rows.set('p2', player('p2', { ban: { at: new Date(NOW), until: null, reason: 'x' } }));
    const found = await service.search('aura');
    expect(store.searches).toEqual([{ q: 'aura', limit: 20 }]);
    expect(adminPlayerSearchResponseSchema.parse(found).players).toEqual([
      {
        id: 'p1',
        displayName: 'Aura p1',
        createdAt: new Date(NOW - 86_400_000).toISOString(),
        lastSeenAt: new Date(NOW - 60_000).toISOString(),
        banned: false,
      },
      expect.objectContaining({ id: 'p2', banned: true }),
    ]);
  });

  it('un bannissement echu ne compte plus comme banni', async () => {
    const { store, service } = build();
    store.rows.set(
      'p3',
      player('p3', { ban: { at: new Date(0), until: new Date(NOW), reason: 'x' } }),
    );
    expect((await service.search('p3')).players[0]?.banned).toBe(false);
    expect((await service.detail('p3'))?.ban).toBeNull();
  });

  it('fiche : niveau deduit de l experience, portefeuille, ligue, matchs vus du joueur', async () => {
    const { store, service } = build();
    store.rows.set('p1', player('p1'));
    const detail = await service.detail('p1');
    expect(adminPlayerDetailSchema.parse(detail)).toMatchObject({
      id: 'p1',
      level: levelFor(1_234).level,
      xp: 1_234,
      wallet: { soft: 50, hard: 3 },
      league: 'naissante',
      ban: null,
    });
    expect(detail?.recentMatches.map((match) => [match.id, match.won, match.ghost])).toEqual([
      ['m1', true, false],
      ['m2', false, true],
      // Inacheve : ni gagne ni perdu.
      ['m3', null, false],
    ]);
  });

  it('fiche d un joueur inconnu : null', async () => {
    const { service } = build();
    expect(await service.detail('inconnu')).toBeNull();
  });
});

describe('AdminPlayersService — bannissement', () => {
  it('bannit jusqu a une date, journalise, et previent le module match', async () => {
    const { store, service, banned } = build();
    store.rows.set('p1', player('p1'));
    const until = new Date(NOW + 86_400_000).toISOString();
    const detail = await service.ban('p1', { until, reason: 'triche au timing' });

    expect(detail?.ban).toEqual({
      until,
      reason: 'triche au timing',
      at: new Date(NOW).toISOString(),
    });
    expect(banned).toEqual(['p1']);
    expect(store.audits).toEqual([
      {
        action: 'player.ban',
        target: 'p1',
        before: null,
        after: { at: new Date(NOW).toISOString(), until, reason: 'triche au timing' },
        reason: 'triche au timing',
        atMs: NOW,
      },
    ]);
  });

  it('bannit definitivement avec until null', async () => {
    const { store, service } = build();
    store.rows.set('p1', player('p1'));
    const detail = await service.ban('p1', { until: null, reason: 'compte vole' });
    expect(detail?.ban?.until).toBeNull();
    expect(store.rows.get('p1')?.ban).toEqual({
      at: new Date(NOW),
      until: null,
      reason: 'compte vole',
    });
  });

  it('refuse une fin de bannissement deja passee', async () => {
    const { store, service, banned } = build();
    store.rows.set('p1', player('p1'));
    await expect(
      service.ban('p1', { until: new Date(NOW).toISOString(), reason: 'trop tard' }),
    ).rejects.toBeInstanceOf(InvalidBanError);
    expect(store.audits).toEqual([]);
    expect(banned).toEqual([]);
  });

  it('un joueur inconnu : null, rien de journalise', async () => {
    const { store, service, banned } = build();
    expect(await service.ban('inconnu', { until: null, reason: 'motif' })).toBeNull();
    expect(store.audits).toEqual([]);
    expect(banned).toEqual([]);
  });

  it('leve un bannissement et journalise l etat d avant', async () => {
    const { store, service, banned } = build();
    const ban = { at: new Date(NOW - 1_000), until: null, reason: 'compte vole' };
    store.rows.set('p1', player('p1', { ban }));
    const detail = await service.unban('p1', { reason: 'compte rendu' });
    expect(detail?.ban).toBeNull();
    expect(banned).toEqual([]);
    expect(store.audits[0]).toEqual({
      action: 'player.unban',
      target: 'p1',
      before: { at: ban.at.toISOString(), until: null, reason: 'compte vole' },
      after: null,
      reason: 'compte rendu',
      atMs: NOW,
    });
  });
});
