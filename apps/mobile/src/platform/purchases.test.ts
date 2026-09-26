import { TOKEN_PACKS } from '@aura/content';
import { describe, expect, it } from 'vitest';
import { revenueCatStore, type PurchasesPlugin } from './purchases.js';

function fakePlugin(options: { cancel?: boolean; loginFails?: number } = {}) {
  let loginFailures = options.loginFails ?? 0;
  const calls: string[] = [];
  const plugin: PurchasesPlugin = {
    configure: (config) => {
      calls.push(`configure:${config.appUserID ?? ''}`);
      return Promise.resolve();
    },
    logIn: ({ appUserID }) => {
      calls.push(`logIn:${appUserID}`);
      if (loginFailures > 0) {
        loginFailures -= 1;
        return Promise.reject(new Error('hors ligne'));
      }
      return Promise.resolve({});
    },
    getProducts: ({ productIdentifiers, type }) => {
      calls.push(`type:${type ?? ''}`);
      return Promise.resolve({
        products: productIdentifiers.map((identifier) => ({ identifier, priceString: '0,99 €' })),
      });
    },
    purchaseStoreProduct: ({ product }) => {
      calls.push(`buy:${product.identifier}`);
      return options.cancel === true
        ? Promise.reject(Object.assign(new Error('annule'), { userCancelled: true }))
        : Promise.resolve({});
    },
  };
  return { plugin, calls };
}

describe('revenueCatStore', () => {
  // Le webhook credite `app_user_id` : c'est l'identifiant du JOUEUR qu'on declare.
  it('se configure avec l identifiant du joueur', async () => {
    const { plugin, calls } = fakePlugin();
    const store = revenueCatStore(plugin, 'cle', 'joueur-1');
    await store.products();
    expect(calls[0]).toBe('configure:joueur-1');
  });

  it('demande au store les packs du catalogue, et achete le produit choisi', async () => {
    const { plugin, calls } = fakePlugin();
    const store = revenueCatStore(plugin, 'cle', 'joueur-1');
    const products = await store.products();
    expect(products.map((p) => p.identifier)).toEqual(TOKEN_PACKS.map((p) => p.productId));
    expect(await store.buy(TOKEN_PACKS[0]!.productId)).toBe('bought');
    expect(calls).toContain(`buy:${TOKEN_PACKS[0]!.productId}`);
  });

  // Par defaut le greffon cherche des ABONNEMENTS : sur Android, un pack
  // consommable ne revenait pas, et la boutique n'affichait rien.
  it('demande des produits consommables, pas des abonnements', async () => {
    const { plugin, calls } = fakePlugin();
    await revenueCatStore(plugin, 'cle', 'joueur-1').products();
    expect(calls).toContain('type:NON_SUBSCRIPTION');
  });

  it('distingue une annulation du joueur d un echec', async () => {
    const { plugin } = fakePlugin({ cancel: true });
    const store = revenueCatStore(plugin, 'cle', 'joueur-1');
    await store.products();
    expect(await store.buy(TOKEN_PACKS[0]!.productId)).toBe('cancelled');
    expect(await store.buy('aura.inconnu')).toBe('failed');
  });

  // RevenueCat ne se configure qu'une fois par application : un autre compte
  // sur le meme telephone change d'identite, il ne reconfigure pas.
  it('change d identite au lieu de reconfigurer pour un autre joueur', async () => {
    const { plugin, calls } = fakePlugin();
    await revenueCatStore(plugin, 'cle', 'joueur-1').products();
    await revenueCatStore(plugin, 'cle', 'joueur-2').products();
    expect(calls.filter((c) => c.startsWith('configure'))).toEqual(['configure:joueur-1']);
    expect(calls).toContain('logIn:joueur-2');
  });

  /*
    Un changement de compte hors ligne echoue. L'achat doit le dire
    ('failed'), jamais rejeter — et la tentative suivante doit reessayer au
    lieu de rejouer pour toujours l'echec garde en memoire.
  */
  it('ne garde pas en memoire un changement de compte qui a echoue', async () => {
    const { plugin, calls } = fakePlugin({ loginFails: 1 });
    await revenueCatStore(plugin, 'cle', 'joueur-1').products();
    const second = revenueCatStore(plugin, 'cle', 'joueur-2');
    await expect(second.products()).rejects.toThrow('hors ligne');
    await second.products();
    expect(await second.buy(TOKEN_PACKS[0]!.productId)).toBe('bought');
    expect(calls.filter((c) => c === 'logIn:joueur-2')).toHaveLength(2);
  });
});
