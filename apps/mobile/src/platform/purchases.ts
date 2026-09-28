import { TOKEN_PACKS } from '@aura/content';
import type { StoreProduct } from '../app/tokenShop.js';
import { isNative } from './capacitor.js';

/**
 * L'achat de jetons en argent reel, par RevenueCat (ADR 0016).
 *
 * Le telephone ne fait qu'ouvrir la feuille de paiement du store. Il ne
 * credite rien et n'annonce rien au serveur : RevenueCat valide le recu et
 * previent le serveur par webhook, qui credite. Le telephone relit ensuite sa
 * bourse (regle d'or n°1).
 */

/** Le strict necessaire du greffon, injecte pour rester testable. */
export interface PurchasesPlugin {
  configure(config: { apiKey: string; appUserID?: string | null }): Promise<void>;
  logIn(options: { appUserID: string }): Promise<unknown>;
  getProducts(options: {
    productIdentifiers: string[];
    type?: 'NON_SUBSCRIPTION';
  }): Promise<{ products: readonly (StoreProduct & object)[] }>;
  purchaseStoreProduct(options: { product: StoreProduct & object }): Promise<unknown>;
}

export type TokenPurchaseOutcome = 'bought' | 'cancelled' | 'failed';

export interface TokenStore {
  products(): Promise<readonly StoreProduct[]>;
  buy(productId: string): Promise<TokenPurchaseOutcome>;
}

/**
 * L'identite declaree a chaque greffon : RevenueCat ne se configure qu'une
 * fois par application.
 */
const identities = new WeakMap<PurchasesPlugin, { playerId: string; ready: Promise<void> }>();

/**
 * Le magasin de jetons au-dessus du greffon.
 *
 * Configure une seule fois, avec l'identifiant du JOUEUR : c'est lui que le
 * webhook renvoie dans `app_user_id`, et un identifiant anonyme n'y designerait
 * personne a crediter.
 */
export function revenueCatStore(
  plugin: PurchasesPlugin,
  apiKey: string,
  playerId: string,
): TokenStore {
  const known = new Map<string, StoreProduct & object>();
  const configure = (): Promise<void> => {
    const current = identities.get(plugin);
    if (current === undefined) {
      const ready = plugin.configure({ apiKey, appUserID: playerId });
      identities.set(plugin, { playerId, ready });
      return ready;
    }
    if (current.playerId === playerId) return current.ready;
    // Un autre compte sur le meme telephone (compte restaure) : changer
    // d'identite, jamais reconfigurer.
    const ready = current.ready
      .then(() => plugin.logIn({ appUserID: playerId }))
      .then(() => undefined);
    identities.set(plugin, { playerId, ready });
    // Un echec (hors ligne) ne se garde pas : la tentative suivante reessaie.
    // Le greffon reste configure, sous l'identite d'avant.
    ready.catch(() => {
      if (identities.get(plugin)?.ready === ready) identities.set(plugin, current);
    });
    return ready;
  };

  return {
    async products() {
      await configure();
      const { products } = await plugin.getProducts({
        productIdentifiers: TOKEN_PACKS.map((pack) => pack.productId),
        // Des consommables : par defaut le greffon cherche des abonnements, et
        // Android ne rendrait alors aucun pack.
        type: 'NON_SUBSCRIPTION',
      });
      for (const product of products) known.set(product.identifier, product);
      return products;
    },
    async buy(productId) {
      const product = known.get(productId);
      if (product === undefined) return 'failed';
      try {
        // Dans le `try` : un changement de compte hors ligne echoue ici, et
        // l'achat doit le dire plutot que rejeter.
        await configure();
        await plugin.purchaseStoreProduct({ product });
        return 'bought';
      } catch (cause) {
        const cancelled = (cause as { userCancelled?: boolean | null }).userCancelled === true;
        return cancelled ? 'cancelled' : 'failed';
      }
    },
  };
}

/** La cle publique de RevenueCat pour la plateforme courante, ou `null`. */
function apiKeyForPlatform(): string | null {
  const bridge = (globalThis as { Capacitor?: { getPlatform?: () => string } }).Capacitor;
  const platform = bridge?.getPlatform?.();
  const key =
    platform === 'ios'
      ? import.meta.env.VITE_REVENUECAT_APPLE_KEY
      : platform === 'android'
        ? import.meta.env.VITE_REVENUECAT_GOOGLE_KEY
        : undefined;
  return key === undefined || key === '' ? null : key;
}

/**
 * Le magasin de jetons, ou `null` hors application native ou sans cle.
 *
 * Import dynamique derriere `isNative()`, comme les autres greffons : le
 * navigateur ne telecharge pas un SDK de paiement qui n'y ferait rien.
 */
export async function loadTokenStore(playerId: string): Promise<TokenStore | null> {
  if (!isNative()) return null;
  const apiKey = apiKeyForPlatform();
  if (apiKey === null) return null;
  try {
    const { Purchases } = await import('@revenuecat/purchases-capacitor');
    return revenueCatStore(Purchases as unknown as PurchasesPlugin, apiKey, playerId);
  } catch {
    return null;
  }
}
