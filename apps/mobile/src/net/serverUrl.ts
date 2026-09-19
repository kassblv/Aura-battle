/**
 * Resolution de l'URL du serveur.
 *
 * Sur telephone, `localhost` designe le telephone lui-meme : une URL de
 * developpement pointant sur localhost ne joindra jamais le Mac. On la reecrit
 * donc avec l'hote depuis lequel la page a ete chargee (l'IP LAN du Mac).
 */
export function resolveServerUrl(
  configured: string | undefined,
  pageHostname: string,
  fallbackPort = 3000,
): string {
  const raw = configured?.trim();
  if (!raw) {
    return `http://${pageHostname}:${fallbackPort}`;
  }

  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(`VITE_SERVER_URL n'est pas une URL valide : ${raw}`);
  }

  const pointsToItself = url.hostname === 'localhost' || url.hostname === '127.0.0.1';
  const pageIsRemote = pageHostname !== 'localhost' && pageHostname !== '127.0.0.1';
  if (pointsToItself && pageIsRemote) {
    url.hostname = pageHostname;
  }

  return url.origin;
}
