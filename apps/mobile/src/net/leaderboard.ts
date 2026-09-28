import { lenient, leaderboardSchema, type LeaderboardPayload } from '@aura/protocol';
import { AuthError, type AuthOptions } from './auth.js';

/** Reponses lues en ignorant les champs ajoutes par un serveur plus recent. */
const leaderboardReply = lenient(leaderboardSchema);

/**
 * La lecture du classement general.
 *
 * Meme forme que le reste du dossier : `fetch` injecte, reponse validee, et
 * un refus qui se distingue d une absence de reseau — l interface peut alors
 * proposer « reessayer » plutot que « corrige ta demande ».
 */
export async function readLeaderboard(
  baseUrl: string,
  accessToken: string,
  options: AuthOptions = {},
): Promise<LeaderboardPayload> {
  const fetcher = options.fetcher ?? globalThis.fetch.bind(globalThis);

  let response: Response;
  try {
    response = await fetcher(`${baseUrl.replace(/\/+$/, '')}/leaderboard`, {
      headers: { authorization: `Bearer ${accessToken}` },
    });
  } catch {
    throw new AuthError('UNREACHABLE');
  }

  if (response.status === 401) throw new AuthError('UNAUTHORIZED');
  if (!response.ok) throw new AuthError('REJECTED');

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new AuthError('MALFORMED');
  }

  const parsed = leaderboardReply.safeParse(body);
  if (!parsed.success) throw new AuthError('MALFORMED');
  return parsed.data;
}
