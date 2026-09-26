/**
 * Resolution de l'URL du serveur.
 *
 * Deux situations, et une seule fonction pour les distinguer :
 *
 * - **En production**, le serveur de match sert aussi le client. L'API vit
 *   donc a la MEME origine que la page, derriere le meme proxy et le meme
 *   certificat. C'est le defaut.
 * - **En developpement**, Vite sert la page sur un port et le serveur ecoute
 *   sur un autre. L'appelant passe alors `devPort`, parce que lui seul sait
 *   qu'on est en developpement.
 *
 * Et sur telephone, `localhost` designe le telephone lui-meme : une URL de
 * developpement pointant sur localhost ne joindra jamais le Mac. On la reecrit
 * donc avec l'hote depuis lequel la page a ete chargee.
 */

export interface PageLocation {
  /** `window.location.origin` : schema, hote et port de la page servie. */
  readonly origin: string;
  /**
   * Port du serveur de match en developpement.
   *
   * Absent en production, et c'est tout l'interet : sans lui, le repli est
   * l'origine de la page. Un repli qui fabriquait `http://<hote>:3000` en
   * production donnait une adresse en clair sur un port ferme — le jeu
   * s'arretait sur « connexion impossible » alors que le serveur repondait
   * parfaitement a un chemin pres, et rien dans le code ne le laissait voir.
   */
  readonly devPort?: number;
}

export function resolveServerUrl(
  configured: string | undefined,
  pageHostname: string,
  page: PageLocation,
): string {
  const raw = configured?.trim();
  if (!raw) {
    return page.devPort === undefined ? page.origin : `http://${pageHostname}:${page.devPort}`;
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

/**
 * Ou la page a ete servie, telle que le navigateur la decrit.
 *
 * La seule fonction impure du module, et volontairement a cote de la regle
 * qu'elle alimente : deux appelants s'en servent — la session et la socket —
 * et deux copies de cette decision finiraient par se contredire, l'une
 * parlant a la bonne origine pendant que l'autre chercherait un port ferme.
 *
 * `import.meta.env.DEV` est ce qui separe les deux mondes : en developpement
 * Vite sert la page sur son port et le serveur ecoute ailleurs ; en
 * production les deux partagent une origine.
 */
export function currentPageLocation(devPort = 3000): PageLocation {
  const origin = globalThis.location?.origin ?? '';
  return import.meta.env.DEV ? { origin, devPort } : { origin };
}
