import { describe, expect, it, vi } from 'vitest';
import * as fixtures from '../test/fixtures.js';
import { AdminApiError, createAdminApi } from './client.js';

interface Call {
  readonly url: string;
  readonly init: RequestInit;
}

function setup(
  respond: (url: string, init: RequestInit) => Response,
  token: string | null = 's3cret-admin',
) {
  const calls: Call[] = [];
  const onUnauthorized = vi.fn();
  const api = createAdminApi({
    fetch: (input, init = {}) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      calls.push({ url, init });
      return Promise.resolve(respond(url, init));
    },
    token: () => token,
    onUnauthorized,
  });
  return { api, calls, onUnauthorized };
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const headerOf = (init: RequestInit, name: string): string | undefined =>
  (init.headers as Record<string, string>)[name];

async function failure(promise: Promise<unknown>): Promise<AdminApiError> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof AdminApiError) return error;
    throw error;
  }
  throw new Error('la promesse aurait du echouer');
}

describe('client admin — authentification', () => {
  it('envoie le secret dans l en-tete Authorization', async () => {
    const { api, calls } = setup(() => json(fixtures.flags));
    await api.flags();
    expect(calls[0]?.url).toBe('/admin/flags');
    expect(headerOf(calls[0]!.init, 'authorization')).toBe('Bearer s3cret-admin');
    expect(calls[0]?.init.credentials).toBe('omit');
  });

  it('ne met jamais le secret dans l URL, lecture comme ecriture', async () => {
    const { api, calls } = setup((url) =>
      url.startsWith('/admin/players?')
        ? json(fixtures.search)
        : url.startsWith('/admin/audit')
          ? json(fixtures.audit)
          : json({}),
    );
    await api.searchPlayers('nova');
    await api.audit({ action: 'player.ban', target: 'p_1' });
    await api.ban('p_1', { until: null, reason: 'triche avérée' });
    await api.updateFlag('intentBubble', { action: 'pause' });
    await api.overrideEvent(2961, { variant: null });
    expect(calls).toHaveLength(5);
    for (const call of calls) {
      expect(call.url).not.toContain('s3cret-admin');
      expect((call.init.body as string | undefined) ?? '').not.toContain('s3cret-admin');
    }
    expect(calls[0]?.url).toBe('/admin/players?q=nova');
    expect(calls[1]?.url).toBe('/admin/audit?action=player.ban&target=p_1');
  });

  it('401 : erreur « unauthorized » et retour a l ecran de connexion', async () => {
    const { api, onUnauthorized } = setup(() => json({ code: 'UNAUTHORIZED' }, 401));
    const error = await failure(api.status());
    expect(error.kind).toBe('unauthorized');
    expect(error.status).toBe(401);
    expect(onUnauthorized).toHaveBeenCalledTimes(1);
  });

  it('sans secret : aucune requete, retour a la connexion', async () => {
    const { api, calls, onUnauthorized } = setup(() => json(fixtures.flags), null);
    expect((await failure(api.flags())).kind).toBe('unauthorized');
    expect(calls).toHaveLength(0);
    expect(onUnauthorized).toHaveBeenCalled();
  });

  it('429 : « trop d essais, attends une minute », sans deconnexion', async () => {
    const { api, onUnauthorized } = setup(() => json({ code: 'TOO_MANY_REQUESTS' }, 429));
    const error = await failure(api.status());
    expect(error.kind).toBe('rate-limited');
    expect(error.message).toMatch(/trop d’essais, attends une minute/i);
    expect(onUnauthorized).not.toHaveBeenCalled();
  });

  it('404 : dit que le panneau peut etre desactive', async () => {
    const { api } = setup(() => json({ code: 'NOT_FOUND' }, 404));
    const error = await failure(api.flags());
    expect(error.kind).toBe('not-found');
    expect(error.message).toContain('désactivé');
  });

  it('erreur du serveur : le code et le message remontent', async () => {
    const { api } = setup(() => json({ code: 'BAD_REQUEST', message: 'variant inconnue' }, 400));
    const error = await failure(api.overrideEvent(3, { variant: 'normal' }));
    expect(error.kind).toBe('bad-request');
    expect(error.code).toBe('BAD_REQUEST');
    expect(error.message).toContain('400 · BAD_REQUEST');
    expect(error.message).toContain('variant inconnue');
  });

  it('serveur injoignable : erreur reseau lisible', async () => {
    const api = createAdminApi({
      fetch: () => Promise.reject(new TypeError('Failed to fetch')),
      token: () => 't',
      onUnauthorized: () => undefined,
    });
    expect((await failure(api.status())).kind).toBe('network');
  });
});

describe('client admin — validation des reponses', () => {
  it('rend une reponse conforme', async () => {
    const { api } = setup(() => json(fixtures.player));
    expect((await api.player('p_1a2b3c')).displayName).toBe('NovaFlash');
  });

  it('tolere un champ ajoute par un serveur plus recent (lenient)', async () => {
    const { api } = setup(() =>
      json({
        ...fixtures.flags,
        extra: true,
        flags: fixtures.flags.flags.map((f) => ({ ...f, owner: 'x' })),
      }),
    );
    const result = await api.flags();
    expect(result.flags).toHaveLength(2);
    expect(result.flags[0]).not.toHaveProperty('owner');
  });

  it('une reponse non conforme donne une erreur lisible qui nomme le champ', async () => {
    const broken = { flags: [{ ...fixtures.flags.flags[0], rollout: 140 }] };
    const { api } = setup(() => json(broken));
    const error = await failure(api.flags());
    expect(error.kind).toBe('invalid-response');
    expect(error.message).toContain('GET /admin/flags');
    expect(error.message).toContain('flags.0.rollout');
  });

  it('une reponse qui n est pas du JSON est une erreur, pas un plantage', async () => {
    const { api } = setup(() => new Response('<html>', { status: 200 }));
    expect((await failure(api.status())).kind).toBe('invalid-response');
  });

  it('valide aussi les lectures du tableau de bord', async () => {
    const { api } = setup(() => json({ ...fixtures.status, uptimeSeconds: 'longtemps' }));
    const error = await failure(api.status());
    expect(error.message).toContain('uptimeSeconds');
  });
});

describe('client admin — ecritures', () => {
  it('PUT /admin/flags/:flag avec le corps du contrat', async () => {
    const { api, calls } = setup(() => new Response(null, { status: 204 }));
    await api.updateFlag('intentBubble', {
      action: 'new-measure',
      rollout: 30,
      reason: 'nouvel essai',
    });
    expect(calls[0]?.init.method).toBe('PUT');
    expect(calls[0]?.url).toBe('/admin/flags/intentBubble');
    expect(JSON.parse(calls[0]?.init.body as string)).toEqual({
      action: 'new-measure',
      rollout: 30,
      reason: 'nouvel essai',
    });
    expect(headerOf(calls[0]!.init, 'content-type')).toBe('application/json');
  });

  it('encode les identifiants dans le chemin', async () => {
    const { api, calls } = setup(() => json({}));
    await api.unban('a/b?c', { reason: 'erreur de modération' });
    expect(calls[0]?.url).toBe('/admin/players/a%2Fb%3Fc/unban');
  });

  it('refuse avant l envoi un corps hors contrat (part hors bornes, motif trop court)', async () => {
    const { api, calls } = setup(() => json({}));
    expect((await failure(api.updateFlag('x', { action: 'new-measure', rollout: 0 }))).kind).toBe(
      'invalid-request',
    );
    expect((await failure(api.ban('p', { until: null, reason: 'x' }))).kind).toBe(
      'invalid-request',
    );
    expect(calls).toHaveLength(0);
  });
});
