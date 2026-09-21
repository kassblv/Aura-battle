import { describe, expect, it, vi } from 'vitest';
import { AuthError, type Fetcher } from './auth.js';
import { readLeaderboard } from './leaderboard.js';

const classement = {
  top: [
    {
      rank: 1,
      playerId: 'p1',
      displayName: 'Nova',
      leaguePoints: 900,
      league: 'OR_II',
      wins: 40,
      losses: 12,
      isMe: false,
    },
  ],
  around: [],
  me: null,
};

const ok = (body: unknown) =>
  vi.fn<Fetcher>(() => Promise.resolve(new Response(JSON.stringify(body), { status: 200 })));

describe('readLeaderboard', () => {
  it('lit le classement avec le jeton', async () => {
    const fetcher = ok(classement);
    await expect(readLeaderboard('http://srv', 'jeton', { fetcher })).resolves.toEqual(classement);
    expect(fetcher.mock.calls[0]?.[0]).toBe('http://srv/leaderboard');
  });

  /* Un joueur sans classement est le cas normal, pas une panne. */
  it('accepte un classement sans ligne pour soi', async () => {
    await expect(
      readLeaderboard('http://srv', 'jeton', { fetcher: ok({ ...classement, me: null }) }),
    ).resolves.toMatchObject({ me: null });
  });

  it('refuse une reponse qui n a pas la forme attendue', async () => {
    await expect(
      readLeaderboard('http://srv', 'jeton', { fetcher: ok({ top: 'beaucoup' }) }),
    ).rejects.toBeInstanceOf(AuthError);
  });

  it('distingue l absence de reseau d un refus', async () => {
    const fetcher = vi.fn<Fetcher>(() => Promise.reject(new Error('hors ligne')));
    await expect(readLeaderboard('http://srv', 'jeton', { fetcher })).rejects.toMatchObject({
      reason: 'UNREACHABLE',
    });
  });
});
