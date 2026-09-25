import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { SeasonTrack } from '@aura/content';
import type { SeasonState } from '@aura/protocol';
import type { RewardSize } from '../audio/cues.js';
import { AuthError } from '../net/auth.js';
import {
  buySeasonPremium,
  claimAllSeason,
  claimSeasonTier,
  readSeason,
  SeasonRequestError,
} from '../net/season.js';
import { currentPageLocation, resolveServerUrl } from '../net/serverUrl.js';
import {
  claimableCount,
  newlyClaimed,
  announcementAfterRead,
  rewardSize,
  visibleAnnouncement,
  type ClaimedCell,
  type TierAnnouncement,
} from './season.js';

/**
 * Le passe de saison, tenu par le serveur.
 *
 * Aucune bourse ni aucun palier ne se calcule ici : chaque geste rend l'etat
 * complet du passe, et c'est lui qu'on affiche. Un client qui additionnerait
 * aurait raison a l'ecran et tort a l'encaissement.
 *
 * **Hors ligne, le jeu reste jouable** : on le dit, et le solo continue.
 */

export const SEASON_MESSAGES: Readonly<Record<string, string>> = {
  TIER_LOCKED: 'Ce palier n’est pas encore atteint.',
  PREMIUM_REQUIRED: 'Cette récompense demande la piste premium.',
  ALREADY_CLAIMED: 'Cette récompense est déjà récupérée.',
  NO_SEASON: 'Aucune saison en cours.',
  INSUFFICIENT_FUNDS: 'Il te manque des jetons.',
  ALREADY_PREMIUM: 'Tu as déjà la piste premium.',
  RATE_LIMITED: 'Doucement ! Réessaie dans un instant.',
  REJECTED: 'Le serveur a refusé.',
  UNREACHABLE: 'Pas de réseau. Réessaie dans un instant.',
  UNAUTHORIZED: 'Ta session a expiré. Relance le jeu.',
  MALFORMED: 'Réponse inattendue du serveur.',
};

/**
 * Ce que le serveur vient d'accorder, a feter.
 *
 * `key` change a chaque encaissement : deux reclamations de suite relancent
 * l'animation au lieu de laisser la seconde passer inapercue.
 */
export interface SeasonCelebration {
  readonly key: number;
  readonly cells: readonly ClaimedCell[];
  /** La piste premium vient de s'ouvrir. */
  readonly premium: boolean;
  readonly size: RewardSize;
}

export interface SeasonHook {
  readonly state: SeasonState | null;
  readonly busy: boolean;
  readonly error: string | null;
  /** Vrai quand le serveur a repondu au moins une fois. */
  readonly synced: boolean;
  /** Cases a encaisser : la pastille du rail. */
  readonly claimable: number;
  readonly celebration: SeasonCelebration | null;
  /**
   * Le palier atteint pendant le dernier match, pour l'ecran de fin.
   *
   * Compare a la lecture precedente : `match:end` ne porte pas l'XP de saison,
   * et le protocole n'a pas a changer pour une annonce.
   */
  readonly justReached: number | null;
  readonly dismissReached: () => void;
  readonly claim: (tier: number, track: SeasonTrack) => void;
  readonly claimAll: () => void;
  readonly buyPremium: () => void;
  readonly refresh: () => void;
  readonly clearError: () => void;
}

/**
 * @param reloadKey change a la fin d'un match : l'XP de saison vient d'y bouger.
 * @param onGranted appele apres chaque gain accorde — le son, la vibration, et
 *   la relecture de l'inventaire, qui tient la bourse et les possessions.
 */
export function useSeason(
  accessToken: string | null,
  /**
   * Le joueur connecte. Change quand on restaure un autre compte SANS
   * recharger la page : tout l'etat du precedent est alors oublie. Pas le
   * jeton, renouvele toutes les quinze minutes pour le meme joueur.
   */
  playerId: string | null,
  reloadKey: number,
  onGranted: (celebration: SeasonCelebration) => void,
): SeasonHook {
  const [state, setState] = useState<SeasonState | null>(null);
  const [synced, setSynced] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  const [celebration, setCelebration] = useState<SeasonCelebration | null>(null);
  const [announcement, setAnnouncement] = useState<TierAnnouncement | null>(null);

  // L'etat d'avant vit dans une REF : en dependance, il relancerait la lecture
  // a chaque reponse, donc en boucle.
  const previous = useRef<SeasonState | null>(null);
  // La cle de match de la derniere lecture reussie : une lecture pour une
  // NOUVELLE cle est celle qui suit une fin de match.
  const lastReadKey = useRef<number | null>(null);

  /*
    Un autre compte : rien du precedent ne doit survivre — ni sa piste a
    l'ecran, ni sa pastille, ni une comparaison qui annoncerait les paliers de
    l'un comme gagnes par l'autre.
  */
  useEffect(() => {
    previous.current = null;
    lastReadKey.current = null;
    setState(null);
    setSynced(false);
    setAnnouncement(null);
    setCelebration(null);
  }, [playerId]);
  const celebrations = useRef(0);
  const granted = useRef(onGranted);
  granted.current = onGranted;

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
        const fresh = await readSeason(baseUrl(), accessToken);
        if (cancelled) return;
        const matchRead = lastReadKey.current !== null && lastReadKey.current !== reloadKey;
        const found = announcementAfterRead(previous.current, fresh, {
          matchRead,
          match: reloadKey,
        });
        previous.current = fresh;
        lastReadKey.current = reloadKey;
        setState(fresh);
        setSynced(true);
        if (found !== null) setAnnouncement(found);
      } catch {
        if (!cancelled) setSynced(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [accessToken, baseUrl, reloadKey, tick, playerId]);

  const run = useCallback(
    async (action: (url: string, token: string) => Promise<SeasonState>): Promise<void> => {
      if (accessToken === null) {
        setError(SEASON_MESSAGES.UNREACHABLE ?? null);
        return;
      }
      setBusy(true);
      setError(null);
      try {
        const before = previous.current;
        const fresh = await action(baseUrl(), accessToken);
        previous.current = fresh;
        setState(fresh);
        setSynced(true);

        // On fete ce que le serveur a ACCORDE, par difference : jamais ce que
        // le doigt a touche.
        const cells = newlyClaimed(before, fresh);
        const premium = fresh.premium && before?.premium !== true;
        if (cells.length === 0 && !premium) return;
        celebrations.current += 1;
        const party: SeasonCelebration = {
          key: celebrations.current,
          cells,
          premium,
          size: rewardSize(cells, premium),
        };
        setCelebration(party);
        granted.current(party);
      } catch (cause) {
        const reason =
          cause instanceof SeasonRequestError || cause instanceof AuthError
            ? cause.reason
            : undefined;
        setError(SEASON_MESSAGES[reason ?? ''] ?? 'Impossible pour le moment.');
        /*
          Un refus laisse l'ecran en avance sur la verite — une recompense prise
          sur un autre appareil, une saison qui vient de finir. On relit plutot
          que de laisser briller une case que le serveur ne rendra pas.
        */
        setTick((value) => value + 1);
      } finally {
        setBusy(false);
      }
    },
    [accessToken, baseUrl],
  );

  const claim = useCallback(
    (tier: number, track: SeasonTrack) => {
      void run((url, token) => claimSeasonTier(url, token, tier, track));
    },
    [run],
  );

  const claimAll = useCallback(() => {
    void run(claimAllSeason);
  }, [run]);

  const buyPremium = useCallback(() => {
    void run(buySeasonPremium);
  }, [run]);

  const dismissReached = useCallback(() => {
    setAnnouncement(null);
  }, []);

  // Montree seulement a l'ecran de fin du match qui l'a produite.
  const justReached = visibleAnnouncement(announcement, reloadKey);

  // Relire, c'est rouvrir l'ecran : la fete precedente est deja vue, et la
  // rejouer ferait sauter des cases encaissees il y a longtemps.
  const refresh = useCallback(() => {
    setCelebration(null);
    setTick((value) => value + 1);
  }, []);

  const clearError = useCallback(() => {
    setError(null);
  }, []);

  return useMemo(
    () => ({
      state,
      busy,
      error,
      synced,
      claimable: claimableCount(state),
      celebration,
      justReached,
      dismissReached,
      claim,
      claimAll,
      buyPremium,
      refresh,
      clearError,
    }),
    [
      state,
      busy,
      error,
      synced,
      celebration,
      justReached,
      dismissReached,
      claim,
      claimAll,
      buyPremium,
      refresh,
      clearError,
    ],
  );
}
