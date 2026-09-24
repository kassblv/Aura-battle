import { useCallback, useEffect, useMemo, useState } from 'react';
import type { InventoryState } from '@aura/protocol';
import { AuthError } from '../net/auth.js';
import { buyItem, equipLoadout, readInventory, InventoryRequestError } from '../net/inventory.js';
import { currentPageLocation, resolveServerUrl } from '../net/serverUrl.js';
import { lookFromLoadout, loadoutFromLook } from './loadout.js';
import { defaultLook, type Look } from './wardrobe.js';

/**
 * L inventaire du joueur, tenu par le serveur.
 *
 * Il a longtemps vecu dans `localStorage` : un inventaire qu on s offrait
 * soi-meme, perdu en changeant d appareil. Avec le code de recuperation,
 * garder son compte sans garder ses achats n avait plus de sens.
 *
 * **Hors ligne, le jeu reste jouable** : le solo tourne entierement sur
 * l appareil. On affiche alors les defauts plutot que de refuser de demarrer —
 * un inventaire injoignable n est pas une raison de priver quelqu un de la
 * seule partie qui n a jamais eu besoin du serveur.
 */

export const INVENTORY_MESSAGES: Readonly<Record<string, string>> = {
  ALREADY_OWNED: 'Tu possèdes déjà cet objet.',
  INSUFFICIENT_FUNDS: 'Il te manque des pièces.',
  NOT_OWNED: 'Tu ne possèdes pas cet objet.',
  WRONG_SLOT: 'Cette danse ne va pas avec ce mouvement.',
  NOT_PURCHASABLE: 'Cet objet n’est pas en vente.',
  UNAVAILABLE: 'Cet objet n’est plus disponible.',
  UNKNOWN_ITEM: 'Cet objet n’existe plus.',
  RATE_LIMITED: 'Doucement ! Réessaie dans un instant.',
  REJECTED: 'Le serveur a refusé.',
  UNREACHABLE: 'Pas de réseau. Réessaie dans un instant.',
  UNAUTHORIZED: 'Ta session a expiré. Relance le jeu.',
  MALFORMED: 'Réponse inattendue du serveur.',
};

export interface InventoryView {
  readonly wallet: { readonly soft: number; readonly hard: number };
  readonly owned: ReadonlySet<string>;
  readonly look: Look;
  readonly busy: boolean;
  readonly error: string | null;
  /** Vrai quand le serveur a repondu au moins une fois. */
  readonly synced: boolean;
  /**
   * Relit l inventaire.
   *
   * La bourse bouge aussi SANS achat — une recompense de defi la credite. Sans
   * cette relecture, l ecran garderait l ancien total jusqu au prochain achat,
   * et le joueur verrait sa recompense disparaitre.
   */
  readonly refresh: () => void;
  buy(itemId: string): Promise<boolean>;
  equip(look: Look): Promise<boolean>;
  clearError(): void;
}

const EMPTY: InventoryState = { wallet: { soft: 0, hard: 0 }, owned: [], loadout: {} };

export function useInventory(accessToken: string | null, localSkin: string): InventoryView {
  const [state, setState] = useState<InventoryState>(EMPTY);
  const [synced, setSynced] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  /*
    La teinte de peau ne vient pas du serveur : ce n est pas un cosmetique, ni
    identifiant, ni prix, ni ligne au catalogue. C est l appelant qui la
    detient ; elle n entre que dans l apparence calculee, jamais dans la
    lecture de l inventaire.
  */

  const baseUrl = useCallback(
    () =>
      resolveServerUrl(
        import.meta.env.VITE_SERVER_URL,
        window.location.hostname,
        currentPageLocation(),
      ),
    [],
  );

  useEffect(() => {
    if (accessToken === null) return;
    let cancelled = false;

    void (async () => {
      try {
        const fresh = await readInventory(baseUrl(), accessToken);
        if (cancelled) return;
        setState(fresh);
        setSynced(true);
      } catch {
        // Hors ligne : on garde les defauts, et le solo reste jouable.
        if (!cancelled) setSynced(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [accessToken, baseUrl, tick]);

  const run = useCallback(async (action: () => Promise<InventoryState>): Promise<boolean> => {
    setBusy(true);
    setError(null);
    try {
      setState(await action());
      setSynced(true);
      return true;
    } catch (cause) {
      const reason =
        cause instanceof InventoryRequestError || cause instanceof AuthError
          ? cause.reason
          : undefined;
      setError(INVENTORY_MESSAGES[reason ?? ''] ?? 'Impossible pour le moment.');
      return false;
    } finally {
      setBusy(false);
    }
  }, []);

  /*
    Des identites STABLES tant que rien ne change.

    Recalcule a chaque rendu, l inventaire etait un objet neuf soixante fois
    par seconde pendant un duel — l application se redessine a chaque image —
    et tout ce qui en dependait aussi : l apparence, les danses proposees au
    panneau de choix, et donc la memoisation de l ecran de match.
  */
  const owned = useMemo(() => new Set(state.owned), [state.owned]);
  const look = useMemo(
    () => lookFromLoadout(state.loadout, owned, { ...defaultLook(), skin: localSkin }),
    [state.loadout, owned, localSkin],
  );

  const refresh = useCallback(() => {
    setTick((value) => value + 1);
  }, []);

  const buy = useCallback(
    async (itemId: string) => {
      if (accessToken === null) {
        setError(INVENTORY_MESSAGES.UNREACHABLE ?? null);
        return false;
      }
      return run(() => buyItem(baseUrl(), accessToken, itemId));
    },
    [accessToken, baseUrl, run],
  );

  const equip = useCallback(
    async (next: Look) => {
      if (accessToken === null) {
        setError(INVENTORY_MESSAGES.UNREACHABLE ?? null);
        return false;
      }
      return run(() => equipLoadout(baseUrl(), accessToken, loadoutFromLook(next)));
    },
    [accessToken, baseUrl, run],
  );

  const clearError = useCallback(() => {
    setError(null);
  }, []);

  return useMemo(
    () => ({
      wallet: state.wallet,
      owned,
      look,
      busy,
      error,
      synced,
      refresh,
      buy,
      equip,
      clearError,
    }),
    [state.wallet, owned, look, busy, error, synced, refresh, buy, equip, clearError],
  );
}
