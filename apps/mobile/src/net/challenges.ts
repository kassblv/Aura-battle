import {
  lenient,
  challengeClaimSchema,
  dailyChallengesSchema,
  type ChallengeClaim,
  type ChallengeView,
  type DailyChallenges,
} from '@aura/protocol';
import { AuthError, type AuthOptions, type Fetcher } from './auth.js';

/** Reponses lues en ignorant les champs ajoutes par un serveur plus recent. */
const challengeClaimReply = lenient(challengeClaimSchema);
const dailyChallengesReply = lenient(dailyChallengesSchema);

/**
 * Les appels HTTP des defis quotidiens.
 *
 * Meme forme que `inventory.ts` : `fetch` est injecte, la reponse est validee
 * meme venant de notre serveur, et les refus remontent avec **leur code**.
 * C est le client qui choisit les mots, et il les choisit en francais.
 */

export type ChallengeFailure = 'ALREADY_CLAIMED' | 'INCOMPLETE' | 'UNKNOWN_CHALLENGE';

export class ChallengeRequestError extends Error {
  constructor(readonly reason: ChallengeFailure | 'REJECTED') {
    super(reason);
    this.name = 'ChallengeRequestError';
  }
}

const CODES = new Set<string>(['ALREADY_CLAIMED', 'INCOMPLETE', 'UNKNOWN_CHALLENGE']);

const endpoint = (baseUrl: string, path: string): string => `${baseUrl.replace(/\/+$/, '')}${path}`;

const authorized = (accessToken: string): Record<string, string> => ({
  'content-type': 'application/json',
  authorization: `Bearer ${accessToken}`,
});

async function call(url: string, init: RequestInit, fetcher: Fetcher): Promise<unknown> {
  let response: Response;
  try {
    response = await fetcher(url, init);
  } catch {
    // Rien n a ete juge : l interface peut proposer « reessayer » plutot que
    // « corrige ta demande ».
    throw new AuthError('UNREACHABLE');
  }

  // Un jeton refuse n est pas un probleme de defi : c est la session qui doit
  // reagir, et elle reconnait `AuthError`.
  if (response.status === 401) throw new AuthError('UNAUTHORIZED');

  if (!response.ok) {
    const code = await response
      .json()
      .then((body: unknown) => (body as { code?: unknown }).code)
      .catch(() => undefined);
    throw new ChallengeRequestError(
      typeof code === 'string' && CODES.has(code) ? (code as ChallengeFailure) : 'REJECTED',
    );
  }

  try {
    return await response.json();
  } catch {
    throw new AuthError('MALFORMED');
  }
}

export async function readChallenges(
  baseUrl: string,
  accessToken: string,
  options: AuthOptions = {},
): Promise<readonly ChallengeView[]> {
  const body = await call(
    endpoint(baseUrl, '/challenges'),
    { method: 'GET', headers: authorized(accessToken) },
    options.fetcher ?? globalThis.fetch.bind(globalThis),
  );

  /*
    Validee meme venant de notre serveur : un mandataire captif rend une page
    de connexion Wi-Fi avec un code 200, et on afficherait du HTML a la place
    de trois defis.
  */
  const parsed: { success: boolean; data?: DailyChallenges } = dailyChallengesReply.safeParse(body);
  if (!parsed.success || parsed.data === undefined) throw new AuthError('MALFORMED');
  return parsed.data.challenges;
}

/**
 * Encaisse la recompense d un defi.
 *
 * La requete ne porte que l identifiant : le montant vient du serveur, jamais
 * d ici. Il rend aussi l etat complet des defis — la bourse et la progression
 * viennent alors de la MEME reponse, donc aucune des deux ne peut diverger.
 */
export async function claimChallenge(
  baseUrl: string,
  accessToken: string,
  challengeId: string,
  options: AuthOptions = {},
): Promise<ChallengeClaim> {
  const body = await call(
    endpoint(baseUrl, '/challenges/claim'),
    {
      method: 'POST',
      headers: authorized(accessToken),
      body: JSON.stringify({ challengeId }),
    },
    options.fetcher ?? globalThis.fetch.bind(globalThis),
  );

  const parsed = challengeClaimReply.safeParse(body);
  if (!parsed.success) throw new AuthError('MALFORMED');
  return parsed.data;
}
