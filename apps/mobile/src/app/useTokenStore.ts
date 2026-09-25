import { useCallback, useEffect, useRef, useState } from 'react';
import { loadTokenStore, type TokenStore } from '../platform/purchases.js';
import { isNative } from '../platform/capacitor.js';
import {
  noticeAfterWallet,
  tokenOffers,
  type PurchaseNotice,
  type TokenOffer,
} from './tokenShop.js';

/**
 * Les packs de jetons de la boutique (ADR 0016).
 *
 * - `web` : un navigateur ne vend pas de jetons, les stores l'exigent ;
 * - `loading` puis `ready` : les prix du store sont arrives ;
 * - `none` : application sans cle, store injoignable ou sans produit — la
 *   section se tait.
 *
 * Apres un achat, le telephone ne credite rien : le webhook le fait, un peu
 * plus tard. On relit donc la bourse a quelques reprises (`CREDIT_POLL_MS`),
 * et la boutique dit « paiement recu, tes jetons arrivent » jusqu'a ce que la
 * bourse monte — sans quoi le joueur croirait a un echec et paierait deux fois.
 */
export type TokenStoreStatus = 'web' | 'loading' | 'ready' | 'none';

/** Quand relire la bourse apres un achat : le webhook arrive en secondes. */
export const CREDIT_POLL_MS: readonly number[] = [1_500, 4_000, 9_000, 20_000, 45_000];

/** Duree d'affichage d'un message termine (jetons recus, echec). */
const NOTICE_MS = 5_000;

export interface TokenShop {
  readonly status: TokenStoreStatus;
  readonly offers: readonly TokenOffer[];
  /** Le pack en cours d'achat, ou `null`. */
  readonly buying: string | null;
  readonly notice: PurchaseNotice;
  readonly buy: (productId: string) => void;
}

export function useTokenStore(
  playerId: string | null,
  /** Jetons en bourse : la boutique sait ainsi quand le credit est arrive. */
  hard: number,
  rereadWallet: () => void,
): TokenShop {
  const [status, setStatus] = useState<TokenStoreStatus>(() => (isNative() ? 'loading' : 'web'));
  const [offers, setOffers] = useState<readonly TokenOffer[]>([]);
  const [buying, setBuying] = useState<string | null>(null);
  const [notice, setNotice] = useState<PurchaseNotice>(null);
  const store = useRef<TokenStore | null>(null);
  const reread = useRef(rereadWallet);
  reread.current = rereadWallet;
  const hardRef = useRef(hard);
  hardRef.current = hard;
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);

  /*
    Un magasin par joueur. Au changement de compte, l'ancien est oublie AVANT
    que le nouveau arrive : un achat tente entre les deux irait sinon au
    compte precedent. Et un chargement parti pour un autre joueur, qui
    reviendrait en retard, ne remplace rien.
  */
  useEffect(() => {
    store.current = null;
    setOffers([]);
    setStatus(isNative() ? 'loading' : 'web');
    if (!isNative() || playerId === null) return;
    let alive = true;
    void loadTokenStore(playerId)
      .then(async (loaded) => {
        if (!alive) return;
        if (loaded === null) {
          setStatus('none');
          return;
        }
        const products = await loaded.products();
        if (!alive) return;
        const shown = tokenOffers(products);
        store.current = loaded;
        setOffers(shown);
        // Aucun produit au store (pas encore cree) : une section vide se tait.
        setStatus(shown.length === 0 ? 'none' : 'ready');
      })
      .catch(() => {
        if (alive) setStatus('none');
      });
    return () => {
      alive = false;
      store.current = null;
    };
  }, [playerId]);

  // Les relectures de bourse ne survivent pas a l'ecran.
  useEffect(
    () => () => {
      for (const timer of timers.current) clearTimeout(timer);
    },
    [],
  );

  // La bourse a ete relue : l'attente cesse quand les jetons sont la.
  useEffect(() => {
    setNotice((current) => noticeAfterWallet(current, hard));
  }, [hard]);

  // Un message termine s'efface de lui-meme.
  useEffect(() => {
    if (notice === null || notice.kind === 'pending') return;
    const timer = setTimeout(() => {
      setNotice(null);
    }, NOTICE_MS);
    return () => {
      clearTimeout(timer);
    };
  }, [notice]);

  const buy = useCallback((productId: string) => {
    const current = store.current;
    if (current === null) return;
    setBuying(productId);
    const before = hardRef.current;
    void current
      .buy(productId)
      .catch(() => 'failed' as const)
      .then((outcome) => {
        if (outcome === 'cancelled') return;
        if (outcome === 'failed') {
          setNotice({ kind: 'failed' });
          return;
        }
        setNotice({ kind: 'pending', before });
        for (const delay of CREDIT_POLL_MS) {
          timers.current.push(
            setTimeout(() => {
              reread.current();
            }, delay),
          );
        }
      })
      .finally(() => {
        setBuying(null);
      });
  }, []);

  return { status, offers, buying, notice, buy };
}
