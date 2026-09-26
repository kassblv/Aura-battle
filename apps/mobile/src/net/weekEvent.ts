import { lenient, weekEventSchema, type WeekEvent } from '@aura/protocol';
import { AuthError, type AuthOptions } from './auth.js';

/** Reponse lue en ignorant les champs ajoutes par un serveur plus recent. */
const weekEventReply = lenient(weekEventSchema);

/**
 * L'evenement de la semaine, tel que le serveur l'appliquera
 * (`GET /events/week`, protocole 2.7.0).
 *
 * Le serveur peut forcer une semaine depuis le panneau d'administration : la
 * rotation calculee sur l'appareil ne le saurait pas.
 */
export async function readWeekEvent(
  baseUrl: string,
  accessToken: string,
  options: AuthOptions = {},
): Promise<WeekEvent> {
  const fetcher = options.fetcher ?? globalThis.fetch.bind(globalThis);

  let response: Response;
  try {
    response = await fetcher(`${baseUrl.replace(/\/+$/, '')}/events/week`, {
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

  const parsed = weekEventReply.safeParse(body);
  if (!parsed.success) throw new AuthError('MALFORMED');
  return parsed.data;
}
