import { useCallback, useEffect, useRef, useState } from 'react';
import { loadTokenStore, type TokenStore } from '../platform/purchases.js';
import { isNative } from '../platform/capacitor.js';
import { tokenOffers, type TokenOffer } from './tokenShop.js';

/**
 * Les packs de jetons de la boutique (ADR 0016).
 *
 * - `web` : un navigateur ne vend pas de jetons, les stores l'exigent ;
 * - `loading` puis `ready` : les prix du store sont arrives ;
 * - `none` : application sans cle ou store injoignable — la section se tait.
 *
 * Apres un achat, le telephone ne credite rien : le webhook le fait, un peu
 * plus tard. On relit donc la bourse a quelques reprises (`CREDIT_POLL_MS`).
 */
export type TokenStoreStatus = 'web' | 'loading' | 'ready' | 'none';

/** Quand relire la bourse apres un achat : le webhook arrive en secondes. */
export const CREDIT_POLL_MS: readonly number[] = [1_500, 4_000, 9_000];

export interface TokenShop {
  readonly status: TokenStoreStatus;
  readonly offers: readonly TokenOffer[];
  /** Le pack en cours d'achat, ou `null`. */
  readonly buying: string | null;
  readonly buy: (productId: string) => void;
}

export function useTokenStore(playerId: string | null, rereadWallet: () => void): TokenShop {
  const [status, setStatus] = useState<TokenStoreStatus>(() => (isNative() ? 'loading' : 'web'));
  const [offers, setOffers] = useState<readonly TokenOffer[]>([]);
  const [buying, setBuying] = useState<string | null>(null);
  const store = useRef<TokenStore | null>(null);
  const reread = useRef(rereadWallet);
  reread.current = rereadWallet;

  useEffect(() => {
    if (!isNative() || playerId === null) return;
    let alive = true;
    void loadTokenStore(playerId)
      .then(async (loaded) => {
        if (loaded === null) {
          if (alive) setStatus('none');
          return;
        }
        store.current = loaded;
        const products = await loaded.products();
        if (!alive) return;
        setOffers(tokenOffers(products));
        setStatus('ready');
      })
      .catch(() => {
        if (alive) setStatus('none');
      });
    return () => {
      alive = false;
    };
  }, [playerId]);

  const buy = useCallback((productId: string) => {
    const current = store.current;
    if (current === null) return;
    setBuying(productId);
    void current.buy(productId).then((outcome) => {
      setBuying(null);
      if (outcome !== 'bought') return;
      for (const delay of CREDIT_POLL_MS) {
        setTimeout(() => {
          reread.current();
        }, delay);
      }
    });
  }, []);

  return { status, offers, buying, buy };
}
