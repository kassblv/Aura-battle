import {
  displayNameSchema,
  recoveryCodeResponseSchema,
  sessionResponseSchema,
  type SessionResponse,
} from '@aura/protocol';

/**
 * Les appels HTTP d authentification.
 *
 * `fetch` est injecte : ces fonctions se testent alors sans reseau, et le jour
 * ou Capacitor impose son propre client HTTP, il entre par la meme porte.
 */

export type AuthFailure =
  'UNREACHABLE' | 'REJECTED' | 'UNAUTHORIZED' | 'MALFORMED' | 'INVALID_NAME';

export class AuthError extends Error {
  constructor(readonly reason: AuthFailure) {
    super(reason);
    this.name = 'AuthError';
  }
}

export type Fetcher = (url: string, init?: RequestInit) => Promise<Response>;

export interface AuthOptions {
  readonly fetcher?: Fetcher;
}

const endpoint = (baseUrl: string, path: string): string => `${baseUrl.replace(/\/+$/, '')}${path}`;

async function send(url: string, init: RequestInit, fetcher: Fetcher): Promise<unknown> {
  let response: Response;
  try {
    response = await fetcher(url, init);
  } catch {
    // Pas de reseau, DNS muet, serveur eteint : rien n a ete juge. Distinguer
    // ce cas d un refus permet a l interface de proposer « reessayer » plutot
    // que « corrige ta saisie ».
    throw new AuthError('UNREACHABLE');
  }

  if (response.status === 401) throw new AuthError('UNAUTHORIZED');
  if (!response.ok) throw new AuthError('REJECTED');

  try {
    return await response.json();
  } catch {
    throw new AuthError('MALFORMED');
  }
}

/**
 * Ouvre une session a partir du secret d appareil.
 *
 * Le secret part dans le corps, jamais dans l URL : une URL est journalisee par
 * tous les mandataires de la chaine, et ce secret vaut mot de passe.
 */
export async function authenticateDevice(
  baseUrl: string,
  deviceSecret: string,
  options: AuthOptions = {},
): Promise<SessionResponse> {
  const body = await send(
    endpoint(baseUrl, '/auth/device'),
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ deviceSecret }),
    },
    options.fetcher ?? globalThis.fetch.bind(globalThis),
  );

  /**
   * La reponse est validee, meme venant de notre serveur.
   *
   * Un mandataire captif rend une page de connexion Wi-Fi avec un code 200 :
   * sans ce controle, on rangerait du HTML a la place d une session, et la
   * panne n apparaitrait qu a la premiere utilisation du jeton.
   */
  const parsed = sessionResponseSchema.safeParse(body);
  if (!parsed.success) throw new AuthError('MALFORMED');
  return parsed.data;
}

export interface ProfileResponse {
  readonly id: string;
  readonly displayName: string;
}

/**
 * Change le nom affiche.
 *
 * La validation locale utilise **le schema du serveur** : un aller-retour pour
 * se voir refuser ce qu on savait deja invalide est une seconde d attente
 * offerte a personne.
 */
export async function renameProfile(
  baseUrl: string,
  accessToken: string,
  displayName: string,
  options: AuthOptions = {},
): Promise<ProfileResponse> {
  const checked = displayNameSchema.safeParse(displayName);
  if (!checked.success) throw new AuthError('INVALID_NAME');

  const body = await send(
    endpoint(baseUrl, '/auth/profile'),
    {
      method: 'PATCH',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({ displayName: checked.data }),
    },
    options.fetcher ?? globalThis.fetch.bind(globalThis),
  );

  const parsed = body as ProfileResponse;
  if (typeof parsed?.displayName !== 'string') throw new AuthError('MALFORMED');
  return parsed;
}

/**
 * Demande un code de recuperation pour la session en cours.
 *
 * Le serveur n en garde que le hache : il ne saura pas le reafficher. C est
 * donc au joueur de le noter, et a l interface de le dire clairement.
 */
export async function issueRecoveryCode(
  baseUrl: string,
  accessToken: string,
  options: AuthOptions = {},
): Promise<string> {
  const body = await send(
    endpoint(baseUrl, '/auth/recovery'),
    {
      method: 'POST',
      headers: { authorization: `Bearer ${accessToken}` },
    },
    options.fetcher ?? globalThis.fetch.bind(globalThis),
  );

  const parsed = recoveryCodeResponseSchema.safeParse(body);
  if (!parsed.success) throw new AuthError('MALFORMED');
  return parsed.data.code;
}

/**
 * Presente un code et ouvre la session du compte qu il designe.
 *
 * Le code part dans le **corps**, jamais dans l URL : une URL est journalisee
 * par tous les mandataires de la chaine, et ce code vaut mot de passe — il
 * ouvre le compte a qui le lit.
 */
export async function claimRecoveryCode(
  baseUrl: string,
  code: string,
  options: AuthOptions = {},
): Promise<SessionResponse> {
  const body = await send(
    endpoint(baseUrl, '/auth/recovery/claim'),
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ code }),
    },
    options.fetcher ?? globalThis.fetch.bind(globalThis),
  );

  const parsed = sessionResponseSchema.safeParse(body);
  if (!parsed.success) throw new AuthError('MALFORMED');
  return parsed.data;
}

/**
 * Rattache le secret d appareil courant au compte de la session.
 *
 * Appele juste apres `claimRecoveryCode`. Sans lui, le navigateur garderait
 * son propre secret et rouvrirait le compte invite local au rechargement
 * suivant : le joueur verrait son compte revenir, puis disparaitre.
 */
export async function linkDevice(
  baseUrl: string,
  accessToken: string,
  deviceSecret: string,
  options: AuthOptions = {},
): Promise<void> {
  await send(
    endpoint(baseUrl, '/auth/device/link'),
    {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({ deviceSecret }),
    },
    options.fetcher ?? globalThis.fetch.bind(globalThis),
  );
}
