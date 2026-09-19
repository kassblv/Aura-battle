import { describe, expect, it, vi } from 'vitest';
import { AuthError, authenticateDevice, renameProfile, type Fetcher } from './auth.js';

const session = {
  accessToken: 'acc',
  refreshToken: 'ref',
  expiresIn: 900,
  player: { id: 'p_1', displayName: 'Invite 4417', guest: true },
};

/** Types comme des `Fetcher` : sans parametres declares, `mock.calls` est vide. */
const ok = (body: unknown) =>
  vi.fn<Fetcher>(() => Promise.resolve(new Response(JSON.stringify(body), { status: 200 })));

const fails = (status: number, body: unknown = {}) =>
  vi.fn<Fetcher>(() => Promise.resolve(new Response(JSON.stringify(body), { status })));

const secret = 'a'.repeat(64);

describe('authenticateDevice', () => {
  it('ouvre une session a partir du secret', async () => {
    const fetcher = ok(session);
    await expect(authenticateDevice('http://srv', secret, { fetcher })).resolves.toMatchObject({
      player: { id: 'p_1' },
    });

    const call = fetcher.mock.calls[0];
    expect(call?.[0]).toBe('http://srv/auth/device');
    expect(call?.[1]?.method).toBe('POST');
  });

  /**
   * Le secret part dans le corps, jamais dans l URL.
   *
   * Une URL est journalisee par tous les mandataires de la chaine, et ce secret
   * vaut mot de passe : le mettre en parametre le repandrait dans des journaux
   * qui ne sont pas les notres.
   */
  it('n expose jamais le secret dans l URL', async () => {
    const fetcher = ok(session);
    await authenticateDevice('http://srv', secret, { fetcher });
    expect(String(fetcher.mock.calls[0]?.[0])).not.toContain(secret);
  });

  it('refuse une reponse qui n a pas la forme attendue', async () => {
    // Un mandataire captif rend du HTML avec un code 200 : sans validation, on
    // rangerait une page de connexion Wi-Fi a la place d une session.
    await expect(
      authenticateDevice('http://srv', secret, { fetcher: ok({ bonjour: true }) }),
    ).rejects.toBeInstanceOf(AuthError);
  });

  it('distingue un refus du serveur d une panne de reseau', async () => {
    await expect(
      authenticateDevice('http://srv', secret, { fetcher: fails(400) }),
    ).rejects.toMatchObject({ reason: 'REJECTED' });

    const offline = vi.fn<Fetcher>(() => Promise.reject(new Error('offline')));
    await expect(
      authenticateDevice('http://srv', secret, { fetcher: offline }),
    ).rejects.toMatchObject({ reason: 'UNREACHABLE' });
  });

  it('recolle une base d URL terminee par une barre', async () => {
    const fetcher = ok(session);
    await authenticateDevice('http://srv/', secret, { fetcher });
    expect(String(fetcher.mock.calls[0]?.[0])).toBe('http://srv/auth/device');
  });
});

describe('renameProfile', () => {
  it('envoie le nom avec le jeton', async () => {
    const fetcher = ok({ id: 'p_1', displayName: 'Kassim' });
    await expect(renameProfile('http://srv', 'acc', 'Kassim', { fetcher })).resolves.toMatchObject({
      displayName: 'Kassim',
    });

    const init = fetcher.mock.calls[0]?.[1];
    expect(init?.method).toBe('PATCH');
    expect(new Headers(init?.headers).get('authorization')).toBe('Bearer acc');
  });

  /**
   * Le client valide avant d envoyer, avec **le schema du serveur**. Un
   * aller-retour pour se voir refuser ce qu on savait deja invalide est une
   * seconde d attente offerte a personne.
   */
  it('refuse un nom invalide sans appeler le serveur', async () => {
    const fetcher = ok({});
    await expect(renameProfile('http://srv', 'acc', 'K', { fetcher })).rejects.toMatchObject({
      reason: 'INVALID_NAME',
    });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('signale une session expiree separement', async () => {
    await expect(
      renameProfile('http://srv', 'acc', 'Kassim', { fetcher: fails(401) }),
    ).rejects.toMatchObject({ reason: 'UNAUTHORIZED' });
  });
});
