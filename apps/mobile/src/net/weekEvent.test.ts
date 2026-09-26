import { describe, expect, it, vi } from 'vitest';
import { AuthError, type Fetcher } from './auth.js';
import { readWeekEvent } from './weekEvent.js';

const week = { week: 2910, variant: 'ultime', endsAt: '2026-09-28T00:00:00.000Z' };

const ok = (body: unknown) =>
  vi.fn<Fetcher>(() => Promise.resolve(new Response(JSON.stringify(body), { status: 200 })));

describe('readWeekEvent', () => {
  it('lit la semaine au serveur, avec le jeton', async () => {
    const fetcher = ok(week);
    await expect(readWeekEvent('http://srv/', 'jeton', { fetcher })).resolves.toEqual(week);
    expect(fetcher.mock.calls[0]?.[0]).toBe('http://srv/events/week');
    expect((fetcher.mock.calls[0]?.[1]?.headers as Record<string, string>).authorization).toBe(
      'Bearer jeton',
    );
  });

  it('ignore un champ ajoute par un serveur plus recent', async () => {
    await expect(
      readWeekEvent('http://srv', 'jeton', { fetcher: ok({ ...week, theme: 'x' }) }),
    ).resolves.toEqual(week);
  });

  it('refuse une reponse qui n a pas la forme attendue', async () => {
    await expect(
      readWeekEvent('http://srv', 'jeton', { fetcher: ok({ week: 'lundi' }) }),
    ).rejects.toBeInstanceOf(AuthError);
  });

  it('distingue l absence de reseau', async () => {
    const fetcher = vi.fn<Fetcher>(() => Promise.reject(new TypeError('Failed to fetch')));
    await expect(readWeekEvent('http://srv', 'jeton', { fetcher })).rejects.toMatchObject({
      reason: 'UNREACHABLE',
    });
  });
});
