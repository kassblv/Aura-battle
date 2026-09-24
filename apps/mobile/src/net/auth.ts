import {
  AUTH_ERROR_CODES,
  displayNameSchema,
  emailSchema,
  emailStatusResponseSchema,
  newPasswordSchema,
  recoveryCodeResponseSchema,
  sessionResponseSchema,
  type AuthErrorCode,
  type EmailStatusResponse,
  type SessionResponse,
} from '@aura/protocol';

/**
 * Les appels HTTP d authentification.
 *
 * `fetch` est injecte : ces fonctions se testent alors sans reseau, et le jour
 * ou Capacitor impose son propre client HTTP, il entre par la meme porte.
 */

export type AuthFailure =
  | 'UNREACHABLE'
  | 'REJECTED'
  | 'UNAUTHORIZED'
  | 'MALFORMED'
  | 'INVALID_NAME'
  | 'INVALID_EMAIL'
  | 'PASSWORD_TOO_SHORT'
  | AuthErrorCode;

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

  if (!response.ok) {
    // Le `code` du corps dit POURQUOI, quand le serveur le sait : un 401
    // « identifiants invalides » n'est pas une session expiree, et les
    // confondre dirait « relance le jeu » a qui s'est trompe de mot de passe.
    const code = await refusalCode(response);
    if (code !== null) throw new AuthError(code);
    if (response.status === 401) throw new AuthError('UNAUTHORIZED');
    throw new AuthError('REJECTED');
  }

  try {
    return await response.json();
  } catch {
    throw new AuthError('MALFORMED');
  }
}

const KNOWN_CODES: ReadonlySet<string> = new Set(AUTH_ERROR_CODES);

/** Le code de refus du corps, s il fait partie de ceux que le client sait dire. */
async function refusalCode(response: Response): Promise<AuthErrorCode | null> {
  try {
    const body = (await response.json()) as { code?: unknown } | null;
    const code = body?.code;
    return typeof code === 'string' && KNOWN_CODES.has(code) ? (code as AuthErrorCode) : null;
  } catch {
    return null;
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

/**
 * Ce que le serveur sait de l adresse rattachee : si elle existe, et masquee.
 *
 * Valide comme une session : un schema ferme refuse une reponse qui porterait
 * plus que l adresse masquee.
 */
export async function fetchEmailStatus(
  baseUrl: string,
  accessToken: string,
  options: AuthOptions = {},
): Promise<EmailStatusResponse> {
  const body = await send(
    endpoint(baseUrl, '/auth/email'),
    { method: 'GET', headers: { authorization: `Bearer ${accessToken}` } },
    options.fetcher ?? globalThis.fetch.bind(globalThis),
  );
  const parsed = emailStatusResponseSchema.safeParse(body);
  if (!parsed.success) throw new AuthError('MALFORMED');
  return parsed.data;
}

/** Controle local de l adresse : le meme schema que le serveur. */
function checkedEmail(email: string): string {
  const parsed = emailSchema.safeParse(email);
  if (!parsed.success) throw new AuthError('INVALID_EMAIL');
  return parsed.data;
}

/** Controle local du mot de passe choisi : la longueur, que le schema connait. */
function checkedNewPassword(password: string): string {
  if (!newPasswordSchema.safeParse(password).success) throw new AuthError('PASSWORD_TOO_SHORT');
  return password;
}

/**
 * Rattache une adresse et un mot de passe au compte de la session.
 *
 * Les regles que le client connait sont verifiees avant l aller-retour ; la
 * liste des mots de passe trop courants, elle, est au serveur, qui repond par
 * un code.
 */
export async function linkEmail(
  baseUrl: string,
  accessToken: string,
  email: string,
  password: string,
  options: AuthOptions = {},
): Promise<EmailStatusResponse> {
  const body = await send(
    endpoint(baseUrl, '/auth/email/link'),
    {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${accessToken}` },
      body: JSON.stringify({ email: checkedEmail(email), password: checkedNewPassword(password) }),
    },
    options.fetcher ?? globalThis.fetch.bind(globalThis),
  );
  const parsed = emailStatusResponseSchema.safeParse(body);
  if (!parsed.success) throw new AuthError('MALFORMED');
  return parsed.data;
}

/**
 * Ouvre la session du compte de cette adresse.
 *
 * Identifiants dans le **corps**, jamais dans l URL. Comme apres un code de
 * recuperation, l appelant rattache ensuite l appareil (`linkDevice`) : sans
 * cela, le rechargement suivant rouvrirait le compte invite local.
 */
export async function loginWithEmail(
  baseUrl: string,
  email: string,
  password: string,
  options: AuthOptions = {},
): Promise<SessionResponse> {
  const body = await send(
    endpoint(baseUrl, '/auth/email/login'),
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: checkedEmail(email), password }),
    },
    options.fetcher ?? globalThis.fetch.bind(globalThis),
  );
  const parsed = sessionResponseSchema.safeParse(body);
  if (!parsed.success) throw new AuthError('MALFORMED');
  return parsed.data;
}

/** La preuve d un changement de mot de passe : l ancien, ou le code de recuperation. */
export type PasswordProof =
  { readonly currentPassword: string } | { readonly recoveryCode: string };

/**
 * Change le mot de passe.
 *
 * Le code de recuperation est le chemin du mot de passe oublie : aucun
 * courrier ne part jamais, c est la seule autre preuve que le joueur detient.
 */
export async function changePassword(
  baseUrl: string,
  accessToken: string,
  proof: PasswordProof,
  newPassword: string,
  options: AuthOptions = {},
): Promise<void> {
  await send(
    endpoint(baseUrl, '/auth/email/password'),
    {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${accessToken}` },
      body: JSON.stringify({ ...proof, newPassword: checkedNewPassword(newPassword) }),
    },
    options.fetcher ?? globalThis.fetch.bind(globalThis),
  );
}
