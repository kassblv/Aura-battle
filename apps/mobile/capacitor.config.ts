import type { CapacitorConfig } from '@capacitor/cli';

/**
 * Configuration Capacitor (jalon M6, ADR 0002 et 0008).
 *
 * `webDir` pointe sur le build de Vite : `pnpm --filter mobile build` d'abord,
 * `npx cap sync` ensuite. Les projets natifs ne sont pas dans ce depot — ils se
 * creent avec `npx cap add ios` et `npx cap add android`, qui demandent Xcode
 * et Android Studio.
 */
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
    ...(process.env.CAP_DEV_URL ? { url: process.env.CAP_DEV_URL, cleartext: true } : {}),
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
