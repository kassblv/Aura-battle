import type { CapacitorConfig } from '@capacitor/cli';

/**
 * Configuration Capacitor (jalon M6, ADR 0002 et 0008).
 *
 * `webDir` pointe sur le build de Vite : `pnpm --filter mobile build` d'abord,
 * `npx cap sync` ensuite. Les projets natifs ne sont pas dans ce depot — ils se
 * creent avec `npx cap add ios` et `npx cap add android`, qui demandent Xcode
 * et Android Studio.
 */
/**
 * Le serveur de dev a charger, s'il est demande — et seulement s'il est LOCAL.
 *
 * `server.url` fait charger toute la page par cette adresse, en clair : une
 * variable oubliee dans un terminal ou une CI au moment d'une vraie version
 * publierait une application pilotee par un serveur quelconque. On n'accepte
 * donc que la machine elle-meme et le reseau prive (10/8, 172.16/12,
 * 192.168/16, *.local), et on refuse bruyamment le reste plutot que de
 * l'ignorer : une commande qui echoue se voit, une option ignoree non.
 */
function devServer(raw: string | undefined): { url?: string; cleartext?: boolean } {
  if (raw === undefined || raw.trim() === '') return {};
  const url = new URL(raw.trim());
  const host = url.hostname;
  const local =
    host === 'localhost' ||
    host === '127.0.0.1' ||
    host.endsWith('.local') ||
    host.startsWith('10.') ||
    host.startsWith('192.168.') ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(host);
  if (!local || (url.protocol !== 'http:' && url.protocol !== 'https:')) {
    throw new Error(
      `CAP_DEV_URL doit viser un serveur de developpement local (recu : ${raw}). ` +
        'Retire la variable pour une version publiee.',
    );
  }
  return { url: url.origin, cleartext: url.protocol === 'http:' };
}

const config: CapacitorConfig = {
  appId: 'com.aurabattle.app',
  appName: 'Aura Battle',
  webDir: 'dist',

  /**
   * L'application embarque son client et parle au serveur par le reseau.
   *
   * `server.url` n'est PAS renseigne : une application qui charge sa page
   * depuis un serveur distant est une application qui ne marche plus quand ce
   * serveur tousse, et qu'Apple refuse regulierement. Le client est donc
   * embarque, et c'est `VITE_SERVER_URL` qui dit ou joindre l'API — sans quoi
   * `resolveServerUrl` retomberait sur l'origine de la page, qui en natif est
   * le systeme de fichiers local.
   */
  server: {
    androidScheme: 'https',
    /*
      Developpement seulement : `CAP_DEV_URL=http://localhost:5173 npx cap sync ios`
      fait charger la page par le serveur Vite. Le client y retrouve alors le
      serveur de jeu tout seul (`resolveServerUrl`, port de dev), et une
      modification s'affiche dans le simulateur sans reconstruire. Sans cette
      variable, rien ne change : le client reste embarque, comme ci-dessus.
      Le fichier genere cote iOS est ignore par git.
    */
    ...devServer(process.env.CAP_DEV_URL),
  },

  plugins: {
    /**
     * L'ecran de demarrage s'efface quand le JEU est pret, pas quand la
     * WebView l'est. Entre les deux il y a le chargement de Three.js, des
     * animations et la premiere image de l'arene : sans cette attente, le
     * joueur voit un ecran noir a la place du splash.
     */
    SplashScreen: {
      launchAutoHide: false,
      backgroundColor: '#150c2e',
    },
  },

  ios: {
    // Le fond derriere la WebView : il se voit pendant le rebond du
    // defilement et au premier instant, avant la premiere image.
    backgroundColor: '#150c2e',
    contentInset: 'never',
  },

  android: {
    backgroundColor: '#150c2e',
  },
};

export default config;
