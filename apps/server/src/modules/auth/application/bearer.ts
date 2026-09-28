/**
 * Lecture de l'en-tete `Authorization`.
 *
 * Volontairement pure et stricte : c'est la premiere chose qu'un serveur lit
 * d'une requete authentifiee, et la derniere ou l'on veut de la tolerance.
 */

/**
 * Longueur maximale du jeton.
 *
 * `handshakeAuthSchema` borne deja le jeton a 4096 octets cote temps reel ; la
 * meme borne vaut ici. Au-dela, ce n'est plus un jeton signe, c'est une charge
 * que quelqu'un essaie de faire passer par un chemin authentifie.
 */
const MAX_TOKEN_LENGTH = 4_096;

/**
 * Le jeton porte par l'en-tete, ou `null`.
 *
 * Un en-tete recu plusieurs fois arrive sous forme de tableau : on prend le
 * premier plutot que de les concatener, parce qu'un en-tete duplique est au
 * mieux une erreur de mandataire et au pire une tentative d'injection.
 */
export function readBearer(header: string | readonly string[] | undefined): string | null {
  // Type `unknown` a dessein : indexer un tableau `readonly string[]` rend
  // `any` aux yeux d eslint, et le controle de type juste en dessous est ce qui
  // doit faire foi.
  const raw: unknown = Array.isArray(header) ? header[0] : header;
  if (typeof raw !== 'string') return null;

  const space = raw.indexOf(' ');
  if (space < 0) return null;

  // La casse du schema n'est pas normalisee entre clients HTTP.
  if (raw.slice(0, space).toLowerCase() !== 'bearer') return null;

  const token = raw.slice(space + 1).trim();
  if (token.length === 0 || token.length > MAX_TOKEN_LENGTH) return null;
  // Un jeton avec un espace, ce sont deux valeurs collees ou un en-tete
  // injecte : dans les deux cas on ne sait pas laquelle verifier, et deviner
  // serait pire que refuser.
  if (/\s/.test(token)) return null;

  return token;
}
