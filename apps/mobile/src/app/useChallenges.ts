import { useCallback, useEffect, useState } from 'react';
import type { ChallengeView } from '@aura/protocol';
import { AuthError } from '../net/auth.js';
import { claimChallenge, ChallengeRequestError, readChallenges } from '../net/challenges.js';
import { currentPageLocation, resolveServerUrl } from '../net/serverUrl.js';

/**
 * Les defis du jour, tenus par le serveur.
 *
 * Aucune progression ne se calcule ici : elle s obtient en JOUANT, et le
 * serveur la compte a la fin de chaque manche. Un client qui la calculerait
 * aurait forcement raison a l ecran et tort a l encaissement.
 *
 * **Hors ligne, le jeu reste jouable** : on affiche une liste vide plutot que
 * de refuser de demarrer. Le solo n a jamais eu besoin du serveur.
 */

const MESSAGES: Readonly<Record<string, string>> = {
  ALREADY_CLAIMED: 'Cette récompense est déjà encaissée.',
  INCOMPLETE: 'Ce défi n’est pas encore terminé.',
  UNKNOWN_CHALLENGE: 'Ce défi n’est plus celui du jour.',
  REJECTED: 'Le serveur a refusé.',
  UNREACHABLE: 'Pas de réseau. Réessaie dans un instant.',
  UNAUTHORIZED: 'Ta session a expiré. Relance le jeu.',
  MALFORMED: 'Réponse inattendue du serveur.',
};

export interface ChallengesView {
  readonly challenges: readonly ChallengeView[];
  readonly busy: boolean;
  readonly error: string | null;
  /** Vrai quand le serveur a repondu au moins une fois. */
  readonly synced: boolean;
  /** Nombre de recompenses qui attendent : c est le pastillage du rail. */
  readonly claimable: number;
  claim(challengeId: string): Promise<number | null>;
  refresh(): void;
  clearError(): void;
}

export function useChallenges(accessToken: string | null, reloadKey: number): ChallengesView {
  const [challenges, setChallenges] = useState<readonly ChallengeView[]>([]);
  const [synced, setSynced] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  const baseUrl = useCallback(
    () =>
      resolveServerUrl(
        import.meta.env.VITE_SERVER_URL,
        window.location.hostname,
        currentPageLocation(),
      ),
    [],
  );

  /*
    `reloadKey` : l appelant le change a la fin d un match.

    Sans cela, le joueur reviendrait de sa partie avec les chiffres d avant et
    croirait que rien n a compte — la seule chose qui fait avancer un defi
    etant precisement ce qu il vient de faire.
  */
  useEffect(() => {
    if (accessToken === null) return;
    let cancelled = false;

    void (async () => {
      try {
        const fresh = await readChallenges(baseUrl(), accessToken);
        if (cancelled) return;
        setChallenges(fresh);
        setSynced(true);
      } catch {
        // Hors ligne : liste vide, et le solo reste jouable.
        if (!cancelled) setSynced(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [accessToken, baseUrl, reloadKey, tick]);

  return {
    challenges,
    busy,
    error,
    synced,
    claimable: challenges.filter((challenge) => challenge.done && !challenge.claimed).length,

    claim: useCallback(
      async (challengeId: string): Promise<number | null> => {
        if (accessToken === null) {
          setError(MESSAGES.UNREACHABLE ?? null);
          return null;
        }
        setBusy(true);
        setError(null);
        try {
          const result = await claimChallenge(baseUrl(), accessToken, challengeId);
          setChallenges(result.challenges);
          setSynced(true);
          return result.reward;
        } catch (cause) {
          const reason =
            cause instanceof ChallengeRequestError || cause instanceof AuthError
              ? cause.reason
              : undefined;
          setError(MESSAGES[reason ?? ''] ?? 'Impossible pour le moment.');
          /*
            Un refus de la base — quelqu un a encaisse ailleurs — laisse
            l ecran en avance sur la verite. On relit plutot que de laisser un
            bouton « encaisser » sur une recompense deja prise.
          */
          setTick((value) => value + 1);
          return null;
        } finally {
          setBusy(false);
        }
      },
      [accessToken, baseUrl],
    ),

    refresh: useCallback(() => {
      setTick((value) => value + 1);
    }, []),

    clearError: useCallback(() => {
      setError(null);
    }, []),
  };
}
