import { inviteFromUrl } from '../app/deepLink.js';
import type { HapticDriver, HapticStyle } from './haptics.js';

/**
 * Le pont vers Capacitor.
 *
 * Tout ce que le natif apporte entre par ce fichier, et par lui seul : le
 * reste du client ne sait pas qu il tourne peut-etre dans une WebView. C est
 * ce qui permet de developper dans un navigateur de bureau sans que rien ne
 * change, et de tester ces fonctions **sans Capacitor**, en leur tendant de
 * faux greffons.
 *
 * Les greffons sont charges paresseusement : les importer a la racine
 * embarquerait leur repli web dans le paquet servi au navigateur, pour du code
 * qui ne fera jamais rien.
 */

/** Le strict necessaire du greffon `App`, pour pouvoir le simuler. */
export interface CapacitorAppLike {
  addListener(
    eventName: 'appStateChange',
    handler: (state: { isActive: boolean }) => void,
  ): Promise<{ remove: () => Promise<void> }>;
  addListener(
    eventName: 'appUrlOpen',
    handler: (event: { url: string }) => void,
  ): Promise<{ remove: () => Promise<void> }>;
}

export interface AppStateHandlers {
  /**
   * L app revient au premier plan.
   *
   * La socket est morte depuis longtemps et l etat affiche date d avant :
   * l appelant redemande `match:state` plutot que de reprendre une partie
   * fantome.
   */
  onResume: () => void;
  onPause: () => void;
}

/** Arrete une surveillance. Sans greffon, ne fait rien. */
export type Unwatch = () => Promise<void>;

const NOOP: Unwatch = () => Promise.resolve();

/**
 * Suit les passages arriere-plan / premier plan.
 *
 * Le dernier etat connu est retenu : iOS et Android emettent parfois deux fois
 * le meme, et reconnecter deux fois de suite ouvrirait deux sockets pour un
 * seul joueur.
 */
export function appStateWatcher(app: CapacitorAppLike | null, handlers: AppStateHandlers): Unwatch {
  if (app === null) return NOOP;

  let active: boolean | null = null;

  /*
    On garde la PROMESSE, pas son resultat.

    `addListener` est asynchrone. Retenir la poignee dans une variable une fois
    resolue laisse une fenetre ou l appelant peut demonter avant que
    l ecouteur soit pose : l arret ne trouve alors rien a retirer, et
    l ecouteur survit a l ecran qui l avait demande.
  */
  const pending = app.addListener('appStateChange', ({ isActive }) => {
    if (isActive === active) return;
    active = isActive;
    if (isActive) handlers.onResume();
    else handlers.onPause();
  });

  return async () => {
    await (await pending).remove();
  };
}

/**
 * Suit les liens d invitation ouverts pendant que l app tourne.
 *
 * Un lien touche dans une conversation alors que le jeu est deja lance
 * n arrive **pas** par l URL de la page : la WebView ne navigue pas, le
 * systeme livre l adresse par un evenement. Sans cet ecouteur, le joueur voit
 * son jeu passer au premier plan sans rien faire d autre.
 *
 * La lecture passe par `inviteFromUrl`, la meme que pour l adresse de la page :
 * un lien venu de l exterieur n a pas a etre juge par une deuxieme regle.
 */
export function deepLinkWatcher(
  app: CapacitorAppLike | null,
  onInvite: (code: string) => void,
): Unwatch {
  if (app === null) return NOOP;

  // Meme raison que ci-dessus : la promesse, pas son resultat.
  const pending = app.addListener('appUrlOpen', ({ url }) => {
    const code = inviteFromUrl(url);
    if (code !== null) onInvite(code);
  });

  return async () => {
    await (await pending).remove();
  };
}

/**
 * Tourne-t-on dans une application native ?
 *
 * Lu sur le pont de Capacitor, qui n existe que la. Dans un navigateur, la
 * reponse est non, et tout ce qui suit se tait.
 */
export function isNative(): boolean {
  const bridge = (globalThis as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor;
  try {
    return bridge?.isNativePlatform?.() ?? false;
  } catch {
    return false;
  }
}

/**
 * Charge les greffons, ou rend `null` hors natif.
 *
 * Import dynamique, et c est volontaire : importer ces modules a la racine
 * embarquerait leur repli web dans le paquet servi au navigateur — du code qui
 * ne fera jamais rien, telecharge par tout le monde.
 */
export async function loadCapacitorApp(): Promise<CapacitorAppLike | null> {
  if (!isNative()) return null;
  try {
    const { App } = await import('@capacitor/app');
    return App;
  } catch {
    // Greffon absent d un build : le jeu tourne, sans le natif.
    return null;
  }
}

/**
 * Le pilote haptique natif, ou `null`.
 *
 * `impact` ne rend pas de promesse ici alors que le greffon en rend une : le
 * `Haptics` du jeu appelle ca depuis une boucle d images et n a rien a
 * attendre. L echec est avale au meme endroit que tous les autres.
 */
export async function loadHapticDriver(): Promise<HapticDriver | null> {
  if (!isNative()) return null;
  try {
    const { Haptics, ImpactStyle } = await import('@capacitor/haptics');
    const styles: Record<HapticStyle, (typeof ImpactStyle)[keyof typeof ImpactStyle]> = {
      light: ImpactStyle.Light,
      medium: ImpactStyle.Medium,
      heavy: ImpactStyle.Heavy,
    };
    return {
      impact(style) {
        void Haptics.impact({ style: styles[style] }).catch(() => {
          // Moteur occupe, permission refusee : rien a faire, et surtout pas
          // interrompre une manche pour ca.
        });
      },
    };
  } catch {
    return null;
  }
}

/**
 * Verrouille l orientation en paysage par le greffon natif.
 *
 * Complete `orientation.ts`, qui utilise l API web : celle-ci exige
 * generalement le plein ecran et n existe pas sur tous les navigateurs. En
 * natif, le verrou est fiable — c est le seul endroit ou ADR 0008 est
 * vraiment tenu.
 */
export async function lockLandscapeNative(): Promise<boolean> {
  if (!isNative()) return false;
  try {
    const { ScreenOrientation } = await import('@capacitor/screen-orientation');
    await ScreenOrientation.lock({ orientation: 'landscape' });
    return true;
  } catch {
    return false;
  }
}

/**
 * Delai maximal avant d effacer l ecran de demarrage, en millisecondes.
 *
 * Garde-fou, et non reglage : `launchAutoHide` est a `false` dans
 * `capacitor.config.ts` parce qu on veut effacer le splash quand le JEU est
 * pret, pas quand la WebView l est. Le prix de ce choix est qu un ecran de
 * demarrage qui n est jamais efface reste a l ecran **pour toujours** — la
 * pire panne possible, et une panne muette. Ce delai garantit qu elle ne peut
 * pas arriver, quoi qu il se passe au chargement.
 */
export const SPLASH_MAX_MS = 6_000;

/** Efface l ecran de demarrage natif. Sans effet hors application. */
export async function hideSplash(): Promise<void> {
  if (!isNative()) return;
  try {
    const { SplashScreen } = await import('@capacitor/splash-screen');
    await SplashScreen.hide();
  } catch {
    // Greffon absent : l ecran s effacera de lui-meme au premier rendu.
  }
}
