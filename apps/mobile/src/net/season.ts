import { seasonStateSchema, type SeasonState } from '@aura/protocol';
import type { SeasonTrack } from '@aura/content';
import { AuthError, type AuthOptions, type Fetcher } from './auth.js';

/**
 * Les appels HTTP du passe de saison.
 *
 * Meme forme que `inventory.ts` : `fetch` est injecte, la reponse est validee
 * meme venant de notre serveur, et les refus remontent avec **leur code**.
 * C est le client qui choisit les mots, et il les choisit en francais.
 *
 * Chaque route rend l etat COMPLET du passe, bourse comprise : l ecran n a
 * jamais rien a additionner, donc rien qui puisse diverger de la base.
 */

/** Les refus que le serveur sait nommer. */
export const SEASON_FAILURES = [
  'TIER_LOCKED',
  'PREMIUM_REQUIRED',
  'ALREADY_CLAIMED',
  'NO_SEASON',
  'INSUFFICIENT_FUNDS',
  'ALREADY_PREMIUM',
  'RATE_LIMITED',
] as const;

export type SeasonFailure = (typeof SEASON_FAILURES)[number];

export class SeasonRequestError extends Error {
  constructor(readonly reason: SeasonFailure | 'REJECTED') {
    super(reason);
    this.name = 'SeasonRequestError';
  }
}

const CODES: ReadonlySet<string> = new Set<string>(SEASON_FAILURES);

const endpoint = (baseUrl: string, path: string): string => `${baseUrl.replace(/\/+$/, '')}${path}`;

/**
 * Les en-tetes d'une requete. Le type de contenu n'est annonce QUE s'il y a un
 * corps : Fastify refuse en 400 un « application/json » vide, avant meme la
 * route — le premium et « Tout recuperer » l'etaient a chaque appui.
 */
const authorized = (accessToken: string, withBody = true): Record<string, string> =>
  withBody
    ? { 'content-type': 'application/json', authorization: `Bearer ${accessToken}` }
    : { authorization: `Bearer ${accessToken}` };

async function call(url: string, init: RequestInit, fetcher: Fetcher): Promise<SeasonState> {
  let response: Response;
  try {
    response = await fetcher(url, init);
  } catch {
    // Rien n a ete juge : l interface peut proposer « reessayer ».
    throw new AuthError('UNREACHABLE');
  }

  // Un jeton refuse est l affaire de la session, qui reconnait `AuthError`.
  if (response.status === 401) throw new AuthError('UNAUTHORIZED');

  if (!response.ok) {
    const code = await response
      .json()
      .then((body: unknown) => (body as { code?: unknown }).code)
      .catch(() => undefined);
    throw new SeasonRequestError(
      typeof code === 'string' && CODES.has(code) ? (code as SeasonFailure) : 'REJECTED',
    );
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new AuthError('MALFORMED');
  }

  // Un mandataire captif rend du HTML avec un code 200 : on ne le range pas
  // a la place d un passe.
  const parsed = seasonStateSchema.safeParse(body);
  if (!parsed.success) throw new AuthError('MALFORMED');
  return parsed.data;
}

export async function readSeason(
  baseUrl: string,
  accessToken: string,
  options: AuthOptions = {},
): Promise<SeasonState> {
  return call(
    endpoint(baseUrl, '/season'),
    { method: 'GET', headers: authorized(accessToken) },
    options.fetcher ?? globalThis.fetch.bind(globalThis),
  );
}

/**
 * Reclame la recompense d un palier, sur une piste.
 *
 * La requete ne porte que le palier et la piste : jamais ce qu on y gagne
 * (regle d or n°1). Le serveur relit la recompense dans le contenu.
 */
export async function claimSeasonTier(
  baseUrl: string,
  accessToken: string,
  tier: number,
  track: SeasonTrack,
  options: AuthOptions = {},
): Promise<SeasonState> {
  return call(
    endpoint(baseUrl, '/season/claim'),
    { method: 'POST', headers: authorized(accessToken), body: JSON.stringify({ tier, track }) },
    options.fetcher ?? globalThis.fetch.bind(globalThis),
  );
}

/** Tout ce qui attend, d un coup. Le serveur decide de ce que « tout » recouvre. */
export async function claimAllSeason(
  baseUrl: string,
  accessToken: string,
  options: AuthOptions = {},
): Promise<SeasonState> {
  return call(
    endpoint(baseUrl, '/season/claim-all'),
    { method: 'POST', headers: authorized(accessToken, false) },
    options.fetcher ?? globalThis.fetch.bind(globalThis),
  );
}

/** La piste premium. Aucun prix dans la requete : il vient du contenu, cote serveur. */
export async function buySeasonPremium(
  baseUrl: string,
  accessToken: string,
  options: AuthOptions = {},
): Promise<SeasonState> {
  return call(
    endpoint(baseUrl, '/season/premium'),
    { method: 'POST', headers: authorized(accessToken, false) },
    options.fetcher ?? globalThis.fetch.bind(globalThis),
  );
}
