/**
 * Le client servi par le serveur de match.
 *
 * Une seule origine pour le jeu et son API : pas de CORS a declarer, pas
 * d URL de serveur figee a la compilation du client, et un seul conteneur a
 * deployer. `main.ts` s en sert quand `CLIENT_DIR` designe un build de Vite ;
 * en developpement la variable est vide et Vite sert le client lui-meme.
 */

/**
 * Chemins qui appartiennent au serveur, pas au client.
 *
 * Tout le reste est une navigation, donc la page. Cette liste doit suivre les
 * `@Controller` et la passerelle Socket.IO : un prefixe oublie ici recevrait
 * du HTML la ou un client attend du JSON.
 */
export const API_PREFIXES = [
  '/admin',
  '/auth',
  '/health',
  '/inventory',
  '/leaderboard',
  '/socket.io',
] as const;

/** Ce qu on reconnait a un fichier du build plutot qu a une navigation. */
const FILE_EXTENSION = /\.[a-z0-9]+$/i;

/**
 * Cette requete doit-elle recevoir `index.html` ?
 *
 * Trois refus, et chacun a coute a quelqu un quelque part :
 *
 * - une **ecriture** n est pas une navigation ; rendre la page sur un `POST`
 *   inconnu transforme une faute de frappe en succes apparent ;
 * - une route d **API** absente doit rester absente, pour qu un client qui
 *   parle une autre version du protocole l apprenne au lieu de recevoir
 *   l accueil ;
 * - un **fichier** absent doit rester absent, sinon le navigateur recoit du
 *   HTML pour du JavaScript et se plaint du type MIME au lieu du nom du
 *   fichier manquant.
 */
export function servesIndex(method: string, url: string): boolean {
  const verb = method.toUpperCase();
  if (verb !== 'GET' && verb !== 'HEAD') return false;

  // La chaine de requete ne change pas la nature de la requete : un lien
  // d invitation en porte une, une route d API interrogee aussi.
  const path = url.split('?')[0] ?? '/';

  // Frontiere de chemin, pas prefixe de texte : « /authentique » n est pas
  // « /auth », et ce defaut-la n apparaitrait qu au jour ou une route du
  // client commencerait par les memes lettres qu une route du serveur.
  for (const prefix of API_PREFIXES) {
    if (path === prefix || path.startsWith(`${prefix}/`)) return false;
  }

  const last = path.slice(path.lastIndexOf('/') + 1);
  return !FILE_EXTENSION.test(last);
}
