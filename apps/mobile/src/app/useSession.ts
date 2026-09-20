import { useCallback, useEffect, useState } from 'react';
import {
  AuthError,
  authenticateDevice,
  claimRecoveryCode,
  issueRecoveryCode,
  linkDevice,
  renameProfile,
} from '../net/auth.js';
import { deviceSecret, rotateDeviceSecret } from '../net/identity.js';
import { loadIdentity, saveIdentity, type StoredIdentity } from '../net/session.js';
import { currentPageLocation, resolveServerUrl } from '../net/serverUrl.js';

/**
 * La session du joueur, du premier lancement au nom choisi.
 *
 * Ouvre la session au montage : il n y a pas d inscription, le secret
 * d appareil suffit. L identite rangee sert d affichage immediat, le serveur
 * la corrige quand il repond — un jeu qui attend le reseau pour afficher un
 * nom montre un ecran vide a chaque demarrage.
 */

export type SessionPhase = 'opening' | 'ready' | 'offline';

export interface SessionState {
  readonly phase: SessionPhase;
  readonly identity: StoredIdentity | null;
  readonly accessToken: string | null;
  /** Message a montrer quand un renommage echoue. */
  readonly error: string | null;
  readonly busy: boolean;
  rename(displayName: string): Promise<boolean>;
  /** Delivre un code de recuperation pour ce compte. */
  issueRecovery(): Promise<string | null>;
  /**
   * Presente un code et rejoint le compte qu il designe.
   *
   * **Abandonne le compte invite de ce navigateur** : l appareil est rattache
   * au compte retrouve, avec un secret neuf. Sans ce rattachement, le
   * rechargement suivant rouvrirait le compte local et la recuperation serait
   * perdue.
   */
  claimRecovery(code: string): Promise<boolean>;
}

const MESSAGES: Readonly<Record<string, string>> = {
  UNREACHABLE: 'Pas de réseau. Réessaie dans un instant.',
  UNAUTHORIZED: 'Ta session a expiré. Relance le jeu.',
  INVALID_CODE: 'Ce code ne correspond à aucun compte.',
  INVALID_NAME: 'Ce nom ne passe pas.',
  REJECTED: 'Le serveur a refusé ce nom.',
  MALFORMED: 'Réponse inattendue du serveur.',
};

export function useSession(): SessionState {
  const [phase, setPhase] = useState<SessionPhase>('opening');
  // On part de ce qui est range : le nom s affiche avant le premier octet recu.
  const [identity, setIdentity] = useState<StoredIdentity | null>(() => loadIdentity());
  const [accessToken, setAccessToken] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const baseUrl = resolveServerUrl(import.meta.env.VITE_SERVER_URL, window.location.hostname, currentPageLocation());

    void (async () => {
      try {
        const session = await authenticateDevice(baseUrl, deviceSecret());
        if (cancelled) return;
        const next = { playerId: session.player.id, displayName: session.player.displayName };
        saveIdentity(next);
        setIdentity(next);
        setAccessToken(session.accessToken);
        setPhase('ready');
      } catch {
        if (cancelled) return;
        /**
         * Hors ligne, on joue quand meme.
         *
         * Le solo tourne entierement sur l appareil : refuser de demarrer parce
         * que le serveur ne repond pas priverait le joueur de la seule partie
         * qui n a jamais eu besoin de lui.
         */
        setPhase('offline');
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  const rename = useCallback(
    async (displayName: string): Promise<boolean> => {
      if (accessToken === null) {
        setError(MESSAGES.UNREACHABLE ?? null);
        return false;
      }
      setBusy(true);
      setError(null);
      try {
        const baseUrl = resolveServerUrl(import.meta.env.VITE_SERVER_URL, window.location.hostname, currentPageLocation());
        const renamed = await renameProfile(baseUrl, accessToken, displayName);
        const next = { playerId: renamed.id, displayName: renamed.displayName };
        saveIdentity(next);
        setIdentity(next);
        return true;
      } catch (cause) {
        setError(
          (cause instanceof AuthError ? MESSAGES[cause.reason] : undefined) ??
            'Impossible de changer le nom pour le moment.',
        );
        return false;
      } finally {
        setBusy(false);
      }
    },
    [accessToken],
  );

  const issueRecovery = useCallback(async (): Promise<string | null> => {
    if (accessToken === null) {
      setError(MESSAGES.UNREACHABLE ?? null);
      return null;
    }
    setBusy(true);
    setError(null);
    try {
      const baseUrl = resolveServerUrl(
        import.meta.env.VITE_SERVER_URL,
        window.location.hostname,
        currentPageLocation(),
      );
      return await issueRecoveryCode(baseUrl, accessToken);
    } catch (cause) {
      setError(
        (cause instanceof AuthError ? MESSAGES[cause.reason] : undefined) ??
          'Impossible d’obtenir un code pour le moment.',
      );
      return null;
    } finally {
      setBusy(false);
    }
  }, [accessToken]);

  const claimRecovery = useCallback(async (code: string): Promise<boolean> => {
    setBusy(true);
    setError(null);
    try {
      const baseUrl = resolveServerUrl(
        import.meta.env.VITE_SERVER_URL,
        window.location.hostname,
        currentPageLocation(),
      );
      const session = await claimRecoveryCode(baseUrl, code);

      /*
        Rattacher l appareil, et dans cet ordre.

        Le navigateur garde son propre secret, qui appartient encore au compte
        invite qu on vient d abandonner. On en tire un NEUF — reutiliser
        l ancien se heurterait a la contrainte d unicite du serveur — puis on
        le rattache au compte retrouve. Sans cette etape, le rechargement
        suivant rouvrirait le compte local : le joueur verrait son compte
        revenir, puis disparaitre.
      */
      await linkDevice(baseUrl, session.accessToken, rotateDeviceSecret());

      const next = { playerId: session.player.id, displayName: session.player.displayName };
      saveIdentity(next);
      setIdentity(next);
      setAccessToken(session.accessToken);
      setPhase('ready');
      return true;
    } catch (cause) {
      const reason = cause instanceof AuthError ? cause.reason : undefined;
      setError(
        (reason === 'UNAUTHORIZED' ? MESSAGES.INVALID_CODE : MESSAGES[reason ?? '']) ??
          'Impossible de retrouver ce compte pour le moment.',
      );
      return false;
    } finally {
      setBusy(false);
    }
  }, []);

  return { phase, identity, accessToken, error, busy, rename, issueRecovery, claimRecovery };
}
