import { describe, expect, it, vi } from 'vitest';
import {
  AuthError,
  authenticateDevice,
  changePassword,
  claimRecoveryCode,
  fetchEmailStatus,
  linkEmail,
  loginWithEmail,
  issueRecoveryCode,
  renameProfile,
  type Fetcher,
} from './auth.js';

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

describe('code de recuperation', () => {
  it('demande un code avec le jeton de session', async () => {
    const calls: { url: string; init: RequestInit | undefined }[] = [];
    const fetcher: Fetcher = (url, init) => {
      calls.push({ url, init });
      return Promise.resolve(
        new Response(JSON.stringify({ code: 'AURA-7K2M-94PX-QTJD-3HVN' }), { status: 200 }),
      );
    };

    await expect(issueRecoveryCode('http://srv', 'jeton-abc', { fetcher })).resolves.toBe(
      'AURA-7K2M-94PX-QTJD-3HVN',
    );
    expect(calls[0]?.url).toBe('http://srv/auth/recovery');
    expect(calls[0]?.init?.method).toBe('POST');
    expect((calls[0]?.init?.headers as Record<string, string>).authorization).toBe(
      'Bearer jeton-abc',
    );
  });

  it('refuse une reponse qui ne porte pas de code', async () => {
    const fetcher: Fetcher = () =>
      Promise.resolve(new Response(JSON.stringify({ autre: 'chose' }), { status: 200 }));
    await expect(issueRecoveryCode('http://srv', 'jeton', { fetcher })).rejects.toMatchObject({
      reason: 'MALFORMED',
    });
  });

  /*
    Le code part dans le CORPS, jamais dans l URL. Une URL est journalisee par
    tous les mandataires de la chaine, et ce code vaut mot de passe : il ouvre
    le compte a qui le lit.
  */
  it('envoie le code dans le corps, pas dans l URL', async () => {
    const calls: { url: string; init: RequestInit | undefined }[] = [];
    const fetcher: Fetcher = (url, init) => {
      calls.push({ url, init });
      return Promise.resolve(new Response(JSON.stringify(session), { status: 200 }));
    };

    await claimRecoveryCode('http://srv', 'AURA-7K2M-94PX-QTJD-3HVN', { fetcher });
    expect(calls[0]?.url).toBe('http://srv/auth/recovery/claim');
    expect(calls[0]?.url).not.toContain('7K2M');
    expect(calls[0]?.init?.body).toContain('7K2M');
  });

  it('rend la session du compte retrouve', async () => {
    const fetcher: Fetcher = () =>
      Promise.resolve(new Response(JSON.stringify(session), { status: 200 }));
    await expect(
      claimRecoveryCode('http://srv', 'AURA-7K2M-94PX-QTJD-3HVN', { fetcher }),
    ).resolves.toEqual(session);
  });

  it('traduit un code refuse en UNAUTHORIZED', async () => {
    const fetcher: Fetcher = () => Promise.resolve(new Response('', { status: 401 }));
    await expect(claimRecoveryCode('http://srv', 'AURA-0000', { fetcher })).rejects.toMatchObject({
      reason: 'UNAUTHORIZED',
    });
  });
});

describe('email et mot de passe', () => {
  const password = 'aura du dimanche';

  async function reasonOf(promise: Promise<unknown>): Promise<string> {
    const thrown = await promise.then(
      () => null,
      (error: unknown) => error,
    );
    expect(thrown).toBeInstanceOf(AuthError);
    return (thrown as AuthError).reason;
  }

  it('se connecte en envoyant les identifiants dans le corps, jamais dans l URL', async () => {
    const fetcher = ok(session);
    await expect(
      loginWithEmail('http://srv', ' Kassim@Gmail.com ', password, { fetcher }),
    ).resolves.toMatchObject({ player: { id: 'p_1' } });

    const [url, init] = fetcher.mock.calls[0] ?? [];
    expect(url).toBe('http://srv/auth/email/login');
    expect(String(url)).not.toContain('kassim');
    expect(String(url)).not.toContain(password);
    // L'adresse part normalisee : c'est la meme chaine que le serveur range.
    expect(JSON.parse(init?.body as string)).toEqual({ email: 'kassim@gmail.com', password });
  });

  /*
    Le client lit le `code` du corps : un 401 « identifiants invalides » n'est
    pas une session expiree, et les confondre dirait « relance le jeu » a
    quelqu'un qui s'est trompe de mot de passe.
  */
  it('distingue des identifiants refuses d une session expiree', async () => {
    expect(
      await reasonOf(
        loginWithEmail('http://srv', 'k@gmail.com', password, {
          fetcher: fails(401, { code: 'INVALID_CREDENTIALS' }),
        }),
      ),
    ).toBe('INVALID_CREDENTIALS');
    expect(
      await reasonOf(
        loginWithEmail('http://srv', 'k@gmail.com', password, {
          fetcher: fails(429, { code: 'TOO_MANY_ATTEMPTS' }),
        }),
      ),
    ).toBe('TOO_MANY_ATTEMPTS');
  });

  it('ignore un code de refus qu il ne connait pas', async () => {
    expect(
      await reasonOf(
        loginWithEmail('http://srv', 'k@gmail.com', password, {
          fetcher: fails(400, { code: 'AUTRE_CHOSE' }),
        }),
      ),
    ).toBe('REJECTED');
  });

  it('refuse une adresse mal formee sans appeler le serveur', async () => {
    const fetcher = ok(session);
    expect(await reasonOf(loginWithEmail('http://srv', 'kassim', password, { fetcher }))).toBe(
      'INVALID_EMAIL',
    );
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('rattache une adresse avec le jeton, et lit l etat masque', async () => {
    const fetcher = ok({ linked: true, maskedEmail: 'k•••@gmail.com' });
    await expect(
      linkEmail('http://srv', 'acc', 'k@gmail.com', password, { fetcher }),
    ).resolves.toEqual({ linked: true, maskedEmail: 'k•••@gmail.com' });
    const [url, init] = fetcher.mock.calls[0] ?? [];
    expect(url).toBe('http://srv/auth/email/link');
    expect(new Headers(init?.headers).get('authorization')).toBe('Bearer acc');
  });

  it('refuse un mot de passe trop court avant l aller-retour', async () => {
    const fetcher = ok({});
    expect(
      await reasonOf(linkEmail('http://srv', 'acc', 'k@gmail.com', 'court', { fetcher })),
    ).toBe('PASSWORD_TOO_SHORT');
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('rapporte une adresse deja prise', async () => {
    expect(
      await reasonOf(
        linkEmail('http://srv', 'acc', 'k@gmail.com', password, {
          fetcher: fails(409, { code: 'EMAIL_UNAVAILABLE' }),
        }),
      ),
    ).toBe('EMAIL_UNAVAILABLE');
  });

  it('lit l etat du rattachement', async () => {
    const fetcher = ok({ linked: false, maskedEmail: null });
    await expect(fetchEmailStatus('http://srv', 'acc', { fetcher })).resolves.toEqual({
      linked: false,
      maskedEmail: null,
    });
    expect(fetcher.mock.calls[0]?.[1]?.method).toBe('GET');
  });

  it('refuse un etat qui porterait autre chose que l adresse masquee', async () => {
    expect(
      await reasonOf(
        fetchEmailStatus('http://srv', 'acc', {
          fetcher: ok({ linked: true, maskedEmail: 'k•••@gmail.com', secretHash: 'x' }),
        }),
      ),
    ).toBe('MALFORMED');
  });

  it('change le mot de passe avec l ancien, ou avec le code de recuperation', async () => {
    const fetcher = ok({ changed: true });
    await changePassword('http://srv', 'acc', { currentPassword: 'ancien' }, password, {
      fetcher,
    });
    await changePassword('http://srv', 'acc', { recoveryCode: 'AURA-XXXX' }, password, {
      fetcher,
    });
    expect(JSON.parse(fetcher.mock.calls[0]?.[1]?.body as string)).toEqual({
      currentPassword: 'ancien',
      newPassword: password,
    });
    expect(JSON.parse(fetcher.mock.calls[1]?.[1]?.body as string)).toEqual({
      recoveryCode: 'AURA-XXXX',
      newPassword: password,
    });
    expect(fetcher.mock.calls[0]?.[0]).toBe('http://srv/auth/email/password');
  });
});
