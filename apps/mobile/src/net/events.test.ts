import { describe, expect, it, vi } from 'vitest';
import type { Fetcher } from './auth.js';
import { reportProductEvent } from './events.js';

const answer = (status: number) =>
  vi.fn<Fetcher>(() => Promise.resolve(new Response(null, { status })));

describe('reportProductEvent', () => {
  it('poste l evenement, et lui seul, avec le jeton', async () => {
    const fetcher = answer(204);
    await reportProductEvent(
      'http://srv/',
      'jeton',
      { kind: 'clip_shared', matchId: 'm_01' },
      {
        fetcher,
      },
    );

    const [url, init] = fetcher.mock.calls[0] ?? [];
    expect(url).toBe('http://srv/events');
    expect(init?.method).toBe('POST');
    expect((init?.headers as Record<string, string>).authorization).toBe('Bearer jeton');
    expect(JSON.parse(init?.body as string)).toStrictEqual({ kind: 'clip_shared', matchId: 'm_01' });
  });

  /*
    Une mesure perdue vaut mieux qu'un ecran qui attend ou qui s'excuse : ni
    une panne de reseau, ni un refus ne remontent au joueur.
  */
  it('se tait sur une panne de reseau', async () => {
    const fetcher = vi.fn<Fetcher>(() => Promise.reject(new TypeError('Failed to fetch')));
    await expect(
      reportProductEvent(
        'http://srv',
        'jeton',
        { kind: 'clip_shared', matchId: 'm_01' },
        {
          fetcher,
        },
      ),
    ).resolves.toBeUndefined();
  });

  it('se tait sur un refus du serveur', async () => {
    await expect(
      reportProductEvent(
        'http://srv',
        'jeton',
        { kind: 'clip_shared', matchId: 'm_01' },
        {
          fetcher: answer(500),
        },
      ),
    ).resolves.toBeUndefined();
  });

  it('poste le mode de recharge, et rien d autre (protocole 2.8.0)', async () => {
    const fetcher = answer(204);
    await reportProductEvent(
      'http://srv',
      'jeton',
      { kind: 'recharge_input', matchId: 'm_01', mode: 'keys' },
      { fetcher },
    );
    const [, init] = fetcher.mock.calls[0] ?? [];
    expect(JSON.parse(init?.body as string)).toStrictEqual({
      kind: 'recharge_input',
      matchId: 'm_01',
      mode: 'keys',
    });
  });

  it('n envoie aucun point de recharge : le schema refuse ce que le serveur calcule', async () => {
    const fetcher = answer(204);
    await reportProductEvent(
      'http://srv',
      'jeton',
      // @ts-expect-error — champ hors protocole
      { kind: 'recharge_input', matchId: 'm_01', mode: 'keys', points: 999 },
      { fetcher },
    );
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('n envoie rien pour un evenement hors protocole', async () => {
    const fetcher = answer(204);
    await reportProductEvent(
      'http://srv',
      'jeton',
      // @ts-expect-error — sorte inconnue
      { kind: 'screen_view', matchId: 'm_01' },
      { fetcher },
    );
    expect(fetcher).not.toHaveBeenCalled();
  });
});
