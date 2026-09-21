import { inventoryStateSchema, type InventoryState, type LoadoutPayload } from '@aura/protocol';
import { AuthError, type AuthOptions, type Fetcher } from './auth.js';

/**
 * Les appels HTTP de l inventaire.
 *
 * Meme forme que `auth.ts` : `fetch` est injecte, la reponse est validee, et
 * les refus du serveur remontent avec **leur code**, pas une phrase. C est le
 * client qui choisit les mots — et il les choisit en francais. Traduire cote
 * serveur serait un deuxieme endroit ou ecrire la meme chose.
 */

/** Les refus que le serveur sait nommer, plus ceux du transport. */
export type InventoryFailure =
  | 'ALREADY_OWNED'
  | 'INSUFFICIENT_FUNDS'
  | 'NOT_OWNED'
  | 'NOT_PURCHASABLE'
  | 'UNAVAILABLE'
  | 'UNKNOWN_ITEM';

export class InventoryRequestError extends Error {
  constructor(readonly reason: InventoryFailure | 'REJECTED') {
    super(reason);
    this.name = 'InventoryRequestError';
  }
}

const endpoint = (baseUrl: string, path: string): string => `${baseUrl.replace(/\/+$/, '')}${path}`;

const CODES = new Set<string>([
  'ALREADY_OWNED',
  'INSUFFICIENT_FUNDS',
  'NOT_OWNED',
  'NOT_PURCHASABLE',
  'UNAVAILABLE',
  'UNKNOWN_ITEM',
]);

async function call(url: string, init: RequestInit, fetcher: Fetcher): Promise<InventoryState> {
  let response: Response;
  try {
    response = await fetcher(url, init);
  } catch {
    // Rien n a ete juge : l interface peut proposer « reessayer » plutot que
    // « corrige ta demande ».
    throw new AuthError('UNREACHABLE');
  }

  // Un jeton refuse n est pas un probleme d inventaire : c est la session qui
  // doit reagir, et elle reconnait `AuthError`.
  if (response.status === 401) throw new AuthError('UNAUTHORIZED');

  if (!response.ok) {
    const code = await response
      .json()
      .then((body: unknown) => (body as { code?: unknown }).code)
      .catch(() => undefined);
    throw new InventoryRequestError(
      typeof code === 'string' && CODES.has(code) ? (code as InventoryFailure) : 'REJECTED',
    );
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new AuthError('MALFORMED');
  }

  /*
    Validee meme venant de notre serveur : un mandataire captif rend une page
    de connexion Wi-Fi avec un code 200, et on rangerait du HTML a la place
    d un inventaire — la panne n apparaitrait qu au premier achat.
  */
  const parsed = inventoryStateSchema.safeParse(body);
  if (!parsed.success) throw new AuthError('MALFORMED');
  return parsed.data;
}

const authorized = (accessToken: string): Record<string, string> => ({
  'content-type': 'application/json',
  authorization: `Bearer ${accessToken}`,
});

export async function readInventory(
  baseUrl: string,
  accessToken: string,
  options: AuthOptions = {},
): Promise<InventoryState> {
  return call(
    endpoint(baseUrl, '/inventory'),
    { method: 'GET', headers: authorized(accessToken) },
    options.fetcher ?? globalThis.fetch.bind(globalThis),
  );
}

/**
 * Achete un objet, et rend l inventaire mis a jour.
 *
 * La requete ne porte **que** l identifiant : le prix vient du catalogue du
 * serveur. Un client qui annonce ce qu il paie est un client qui fixe ses prix.
 */
export async function buyItem(
  baseUrl: string,
  accessToken: string,
  itemId: string,
  options: AuthOptions = {},
): Promise<InventoryState> {
  return call(
    endpoint(baseUrl, '/inventory/buy'),
    { method: 'POST', headers: authorized(accessToken), body: JSON.stringify({ itemId }) },
    options.fetcher ?? globalThis.fetch.bind(globalThis),
  );
}

export async function equipLoadout(
  baseUrl: string,
  accessToken: string,
  loadout: LoadoutPayload,
  options: AuthOptions = {},
): Promise<InventoryState> {
  return call(
    endpoint(baseUrl, '/inventory/loadout'),
    { method: 'PUT', headers: authorized(accessToken), body: JSON.stringify(loadout) },
    options.fetcher ?? globalThis.fetch.bind(globalThis),
  );
}
