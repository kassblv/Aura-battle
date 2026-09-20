import type { Seat } from '@aura/rules';
import { beforeEach, describe, expect, it } from 'vitest';
import type {
  PresenceLeagueCache,
  RatingLookup,
  RatingWriter,
  SeasonRatings,
} from '../domain/ports.js';
import { STARTING_RATING, type RatingSnapshot } from '../domain/rating.js';
import { RatingSettlementService } from './rating-settlement.service.js';

/**
 * Orchestration du classement de fin de match (docs/05, ADR 0010).
 *
 * Le calcul lui-meme est deja couvert, en propriete, par `rating.test.ts` :
 * ce fichier verifie seulement que le service lit, decide, ecrit et degrade
 * exactement quand il le doit — jamais qu'un chiffre precis sort d'une
 * formule.
 */

const SEATS = { a: 'p1', b: 'p2' } as const;
const NOW = Date.parse('2026-09-20T10:00:00Z');

class FakeLookup implements RatingLookup {
  season: SeasonRatings | null = { seasonId: 's_1', ratings: new Map() };
  failure: Error | null = null;
  calls: readonly string[][] = [];

  loadForMatch(playerIds: readonly string[], _nowMs: number): Promise<SeasonRatings | null> {
    this.calls = [...this.calls, [...playerIds]];
    if (this.failure !== null) return Promise.reject(this.failure);
    return Promise.resolve(this.season);
  }

  set(playerId: string, rating: RatingSnapshot): void {
    const ratings = new Map(this.season?.ratings ?? []);
    ratings.set(playerId, rating);
    this.season = { seasonId: this.season?.seasonId ?? 's_1', ratings };
  }
}

class FakeWriter implements RatingWriter {
  saved: { seasonId: string; entries: readonly { playerId: string; rating: RatingSnapshot }[] }[] =
    [];
  failure: Error | null = null;

  saveMany(
    seasonId: string,
    entries: readonly { readonly playerId: string; readonly rating: RatingSnapshot }[],
  ): Promise<void> {
    if (this.failure !== null) return Promise.reject(this.failure);
    this.saved.push({ seasonId, entries: [...entries] });
    return Promise.resolve();
  }
}

class FakePresenceCache implements PresenceLeagueCache {
  readonly leagues = new Map<string, string>();

  setLeague(playerId: string, league: string): void {
    this.leagues.set(playerId, league);
  }
}

let lookup: FakeLookup;
let writer: FakeWriter;
let presence: FakePresenceCache;
let service: RatingSettlementService;

beforeEach(() => {
  lookup = new FakeLookup();
  writer = new FakeWriter();
  presence = new FakePresenceCache();
  service = new RatingSettlementService(lookup, writer, presence);
});

const settle = (
  overrides: Partial<{
    mode: 'RANKED' | 'CASUAL' | 'INVITE' | 'SOLO';
    result: { winner: Seat | null; reason: string };
  }> = {},
) =>
  service.settle({
    mode: overrides.mode ?? 'RANKED',
    seats: SEATS,
    result: overrides.result ?? { winner: 'a', reason: 'rounds' },
    atMs: NOW,
  });

describe('RatingSettlementService — match classe', () => {
  it('fait gagner des LP au vainqueur et en perdre au perdant', async () => {
    // Le perdant part avec des LP a perdre : au plancher (0, la valeur de
    // depart), une defaite ne peut que rester clouee a zero (docs/05, « MMR
    // jamais negatif » vaut aussi pour les LP) — ce n'est pas ce test-ci.
    lookup.set('p2', { ...STARTING_RATING, leaguePoints: 200 });

    const outcome = await settle();

    expect(outcome.a.after.leaguePoints).toBeGreaterThan(outcome.a.before.leaguePoints);
    expect(outcome.b.after.leaguePoints).toBeLessThan(outcome.b.before.leaguePoints);
  });

  it('ecrit les deux joueurs dans la meme saison', async () => {
    await settle();

    expect(writer.saved).toHaveLength(1);
    expect(writer.saved[0]?.seasonId).toBe('s_1');
    expect(writer.saved[0]?.entries.map((e) => e.playerId).sort()).toEqual(['p1', 'p2']);
  });

  it('rafraichit la ligue en cache pour les deux joueurs', async () => {
    await settle();

    expect(presence.leagues.has('p1')).toBe(true);
    expect(presence.leagues.has('p2')).toBe(true);
  });

  it('donne des recompenses au vainqueur et au perdant, l un plus que l autre', async () => {
    const outcome = await settle();

    expect(outcome.a.rewards.softCurrency).toBeGreaterThan(0);
    expect(outcome.b.rewards.softCurrency).toBeGreaterThan(0);
    expect(outcome.a.rewards.softCurrency).toBeGreaterThan(outcome.b.rewards.softCurrency);
  });

  it('part du classement existant, pas de la valeur de depart', async () => {
    lookup.set('p1', { ...STARTING_RATING, mmr: 1_600, leaguePoints: 500 });
    lookup.set('p2', { ...STARTING_RATING, mmr: 1_000, leaguePoints: 0 });

    const outcome = await settle();

    expect(outcome.a.before.leaguePoints).toBe(500);
  });
});

describe('RatingSettlementService — hors ranked', () => {
  it('affiche le classement actuel sans le modifier pour une partie amicale', async () => {
    lookup.set('p1', { ...STARTING_RATING, leaguePoints: 250 });
    lookup.set('p2', { ...STARTING_RATING, leaguePoints: 80 });

    const outcome = await settle({ mode: 'CASUAL' });

    expect(outcome.a.before.leaguePoints).toBe(250);
    expect(outcome.a.after.leaguePoints).toBe(250);
    expect(writer.saved).toHaveLength(0);
    expect(presence.leagues.size).toBe(0);
  });

  it('recompense quand meme les deux joueurs', async () => {
    const outcome = await settle({ mode: 'CASUAL' });

    expect(outcome.a.rewards.softCurrency).toBeGreaterThan(0);
  });
});

describe('RatingSettlementService — abandon (anti-ferme, docs/05)', () => {
  it('ne rapporte rien a celui qui abandonne', async () => {
    const outcome = await settle({ result: { winner: 'b', reason: 'forfeit' } });

    expect(outcome.a.rewards).toEqual({ softCurrency: 0, xp: 0 });
    expect(outcome.b.rewards.softCurrency).toBeGreaterThan(0);
  });

  it('compte quand meme le forfait comme une defaite classee pour l abandonneur', async () => {
    lookup.set('p1', { ...STARTING_RATING, leaguePoints: 200 });

    const outcome = await settle({ result: { winner: 'b', reason: 'forfeit' } });

    expect(outcome.a.after.leaguePoints).toBeLessThan(outcome.a.before.leaguePoints);
  });

  it('un double abandon ne change le classement de personne, et ne rapporte rien', async () => {
    lookup.set('p1', { ...STARTING_RATING, leaguePoints: 300 });
    lookup.set('p2', { ...STARTING_RATING, leaguePoints: 150 });

    const outcome = await settle({ result: { winner: null, reason: 'forfeit' } });

    expect(outcome.a.after.leaguePoints).toBe(outcome.a.before.leaguePoints);
    expect(outcome.b.after.leaguePoints).toBe(outcome.b.before.leaguePoints);
    expect(outcome.a.rewards).toEqual({ softCurrency: 0, xp: 0 });
    expect(outcome.b.rewards).toEqual({ softCurrency: 0, xp: 0 });
    expect(writer.saved).toHaveLength(0);
  });
});

describe('RatingSettlementService — degradation (docs/05 : une base lente ne doit pas priver du resultat)', () => {
  it('rend un classement neutre hors saison, mais garde les recompenses', async () => {
    lookup.season = null;

    const outcome = await settle();

    expect(outcome.a.before.leaguePoints).toBe(0);
    expect(outcome.a.after.leaguePoints).toBe(0);
    expect(outcome.a.rewards.softCurrency).toBeGreaterThan(0);
  });

  it('rend un classement neutre quand la lecture echoue', async () => {
    lookup.failure = new Error('ECONNREFUSED');

    const outcome = await settle();

    expect(outcome.a.after.leaguePoints).toBe(0);
    expect(writer.saved).toHaveLength(0);
  });

  it('n affiche pas le nouveau classement quand l ecriture echoue', async () => {
    lookup.set('p1', { ...STARTING_RATING, leaguePoints: 200 });
    lookup.set('p2', { ...STARTING_RATING, leaguePoints: 200 });
    writer.failure = new Error('ECONNRESET');

    const outcome = await settle();

    expect(outcome.a.after.leaguePoints).toBe(outcome.a.before.leaguePoints);
    expect(presence.leagues.size).toBe(0);
  });

  it('fonctionne sans cache de presence branche', async () => {
    const bareService = new RatingSettlementService(lookup, writer);

    await expect(
      bareService.settle({
        mode: 'RANKED',
        seats: SEATS,
        result: { winner: 'a', reason: 'rounds' },
        atMs: NOW,
      }),
    ).resolves.toBeDefined();
  });
});
