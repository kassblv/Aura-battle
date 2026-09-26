import { describe, expect, it, vi } from 'vitest';
import { AuthError, type Fetcher } from './auth.js';
import { buySeasonPremium, claimAllSeason, claimSeasonTier, readSeason } from './season.js';

const state = {
  season: { number: 1, endsAt: '2026-10-27T00:00:00.000Z' },
  xp: 340,
  tier: 3,
  premium: false,
  claimed: [{ tier: 1, track: 'free' }],
  wallet: { soft: 120, hard: 30 },
};

const ok = (body: unknown) =>
  vi.fn<Fetcher>(() => Promise.resolve(new Response(JSON.stringify(body), { status: 200 })));

const fails = (status: number, body: unknown = {}) =>
  vi.fn<Fetcher>(() => Promise.resolve(new Response(JSON.stringify(body), { status })));

const sentBody = (fetcher: ReturnType<typeof ok>): unknown => {
  const raw = fetcher.mock.calls[0]?.[1]?.body;
  return raw === undefined ? undefined : JSON.parse(typeof raw === 'string' ? raw : 'null');
};

describe('readSeason', () => {
  it('lit le passe avec le jeton', async () => {
    const fetcher = ok(state);
    await expect(readSeason('http://srv/', 'jeton', { fetcher })).resolves.toEqual(state);

    const call = fetcher.mock.calls[0];
    expect(call?.[0]).toBe('http://srv/season');
    expect(call?.[1]?.method).toBe('GET');
    expect((call?.[1]?.headers as Record<string, string>).authorization).toBe('Bearer jeton');
  });

  it('accepte l absence de saison', async () => {
    const empty = { ...state, season: null, xp: 0, tier: 0, claimed: [] };
    await expect(readSeason('http://srv', 'jeton', { fetcher: ok(empty) })).resolves.toEqual(empty);
  });

  // Un champ AJOUTE par un serveur plus recent ne doit pas casser l ecran.
  it('ignore un champ que ce client ne connait pas encore', async () => {
    const futur = { ...state, bonus: 3, season: { ...state.season, theme: 'aurore' } };
    await expect(readSeason('http://srv', 'jeton', { fetcher: ok(futur) })).resolves.toEqual(state);
  });

  // Une page de portail Wi-Fi avec un code 200 ne doit pas passer pour un passe.
  it('refuse une reponse qui n a pas la forme attendue', async () => {
    await expect(
      readSeason('http://srv', 'jeton', { fetcher: ok({ ...state, tier: 'dix' }) }),
    ).rejects.toMatchObject({ reason: 'MALFORMED' });
  });
});

describe('claimSeasonTier', () => {
  /*
    Regle d or n°1 : la requete dit QUOI reclamer, jamais ce qu'on y gagne. Un
    client qui annonce son gain est un client qui le fixe.
  */
  it('envoie le palier et la piste, et jamais un montant', async () => {
    const fetcher = ok(state);
    await claimSeasonTier('http://srv', 'jeton', 2, 'premium', { fetcher });

    expect(fetcher.mock.calls[0]?.[0]).toBe('http://srv/season/claim');
    expect(fetcher.mock.calls[0]?.[1]?.method).toBe('POST');
    expect(sentBody(fetcher)).toEqual({ tier: 2, track: 'premium' });
  });

  it('rend l etat du passe mis a jour', async () => {
    await expect(
      claimSeasonTier('http://srv', 'jeton', 2, 'free', { fetcher: ok(state) }),
    ).resolves.toEqual(state);
  });

  it.each([
    [403, 'TIER_LOCKED'],
    [403, 'PREMIUM_REQUIRED'],
    [409, 'ALREADY_CLAIMED'],
    [404, 'NO_SEASON'],
    [429, 'RATE_LIMITED'],
  ])('remonte un refus %i %s avec son code', async (status, code) => {
    await expect(
      claimSeasonTier('http://srv', 'jeton', 2, 'free', { fetcher: fails(status, { code }) }),
    ).rejects.toMatchObject({ reason: code });
  });

  it('retombe sur REJECTED quand le serveur ne dit pas pourquoi', async () => {
    await expect(
      claimSeasonTier('http://srv', 'jeton', 2, 'free', { fetcher: fails(500, { code: 'X' }) }),
    ).rejects.toMatchObject({ reason: 'REJECTED' });
  });

  it('distingue l absence de reseau d un refus', async () => {
    const fetcher = vi.fn<Fetcher>(() => Promise.reject(new Error('hors ligne')));
    await expect(
      claimSeasonTier('http://srv', 'jeton', 2, 'free', { fetcher }),
    ).rejects.toMatchObject({ reason: 'UNREACHABLE' });
  });

  it('traduit un jeton refuse', async () => {
    await expect(
      claimSeasonTier('http://srv', 'jeton', 2, 'free', { fetcher: fails(401) }),
    ).rejects.toBeInstanceOf(AuthError);
  });
});

describe('claimAllSeason', () => {
  it('ne porte aucun corps : le serveur decide de ce que « tout » recouvre', async () => {
    const fetcher = ok(state);
    await expect(claimAllSeason('http://srv', 'jeton', { fetcher })).resolves.toEqual(state);
    expect(fetcher.mock.calls[0]?.[0]).toBe('http://srv/season/claim-all');
    expect(fetcher.mock.calls[0]?.[1]?.method).toBe('POST');
    expect(sentBody(fetcher)).toBeUndefined();
  });
});

/*
  Un en-tete « application/json » SANS corps : Fastify repond 400 avant meme
  d'atteindre la route (« Body cannot be empty… »). Vu a l'ecran : le premium
  et « Tout recuperer » etaient refuses a chaque appui.
*/
describe('requetes sans corps', () => {
  const headersOf = (fetcher: ReturnType<typeof ok>): Record<string, string> =>
    (fetcher.mock.calls[0]?.[1]?.headers ?? {}) as Record<string, string>;

  it('n annoncent pas de corps JSON qu elles n envoient pas', async () => {
    for (const run of [claimAllSeason, buySeasonPremium]) {
      const fetcher = ok(state);
      await run('http://srv', 'jeton', { fetcher });
      expect(headersOf(fetcher)['content-type']).toBeUndefined();
      expect(headersOf(fetcher).authorization).toBe('Bearer jeton');
    }
  });
});

describe('buySeasonPremium', () => {
  it('n annonce aucun prix', async () => {
    const fetcher = ok({ ...state, premium: true });
    await expect(buySeasonPremium('http://srv', 'jeton', { fetcher })).resolves.toMatchObject({
      premium: true,
    });
    expect(fetcher.mock.calls[0]?.[0]).toBe('http://srv/season/premium');
    expect(sentBody(fetcher)).toBeUndefined();
  });

  it.each([
    [403, 'INSUFFICIENT_FUNDS'],
    [409, 'ALREADY_PREMIUM'],
  ])('remonte un refus %i %s avec son code', async (status, code) => {
    await expect(
      buySeasonPremium('http://srv', 'jeton', { fetcher: fails(status, { code }) }),
    ).rejects.toMatchObject({ reason: code });
  });
});
