import { useCallback, useEffect, useState } from 'react';
import type { EmailStatusResponse, SessionResponse } from '@aura/protocol';
import {
  AuthError,
  authenticateDevice,
  changePassword as requestPasswordChange,
  claimRecoveryCode,
  fetchEmailStatus,
  issueRecoveryCode,
  linkEmail as requestEmailLink,
  loginWithEmail,
  renameProfile,
  type PasswordProof,
} from '../net/auth.js';
import { deviceSecret, joinWithFreshSecret } from '../net/identity.js';
import { loadIdentity, saveIdentity, type StoredIdentity } from '../net/session.js';
import { currentPageLocation, resolveServerUrl } from '../net/serverUrl.js';
import { emailFailureMessage } from './emailAccount.js';

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
  /**
   * Delivre un code de recuperation pour ce compte. L ancien mot de passe est
   * exige des qu un email est rattache.
   */
  issueRecovery(currentPassword?: string): Promise<string | null>;
  /**
   * Presente un code et rejoint le compte qu il designe.
   *
   * **Abandonne le compte invite de ce navigateur** : l appareil est rattache
   * au compte retrouve, avec un secret neuf. Sans ce rattachement, le
   * rechargement suivant rouvrirait le compte local et la recuperation serait
   * perdue.
   */
  claimRecovery(code: string): Promise<boolean>;
  /** L adresse rattachee a ce compte, masquee ; `null` tant qu on ne sait pas. */
  readonly email: EmailStatusResponse | null;
  /** Rattache une adresse et un mot de passe a ce compte. */
  linkEmail(email: string, password: string): Promise<boolean>;
  /**
   * Rejoint le compte de cette adresse — meme consequence que `claimRecovery` :
   * le compte invite de ce navigateur est abandonne.
   */
  loginEmail(email: string, password: string): Promise<boolean>;
  changePassword(proof: PasswordProof, newPassword: string): Promise<boolean>;
}

const MESSAGES: Readonly<Record<string, string>> = {
  UNREACHABLE: 'Pas de réseau. Réessaie dans un instant.',
  UNAUTHORIZED: 'Ta session a expiré. Relance le jeu.',
  INVALID_CODE: 'Ce code ne correspond à aucun compte.',
  INVALID_NAME: 'Ce nom ne passe pas.',
  REJECTED: 'Le serveur a refusé ce nom.',
  MALFORMED: 'Réponse inattendue du serveur.',
};

/** L adresse du serveur, resolue comme partout ailleurs dans ce fichier. */
function serverUrl(): string {
  return resolveServerUrl(
    import.meta.env.VITE_SERVER_URL,
    window.location.hostname,
    currentPageLocation(),
  );
}

export function useSession(): SessionState {
  const [phase, setPhase] = useState<SessionPhase>('opening');
  // On part de ce qui est range : le nom s affiche avant le premier octet recu.
  const [identity, setIdentity] = useState<StoredIdentity | null>(() => loadIdentity());
  const [accessToken, setAccessToken] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [email, setEmail] = useState<EmailStatusResponse | null>(null);

  useEffect(() => {
    let cancelled = false;
    const baseUrl = resolveServerUrl(
      import.meta.env.VITE_SERVER_URL,
      window.location.hostname,
      currentPageLocation(),
    );

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
        const baseUrl = resolveServerUrl(
          import.meta.env.VITE_SERVER_URL,
          window.location.hostname,
          currentPageLocation(),
        );
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

  const issueRecovery = useCallback(
    async (currentPassword?: string): Promise<string | null> => {
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
        return await issueRecoveryCode(
          baseUrl,
          accessToken,
          currentPassword === undefined
            ? { deviceSecret: deviceSecret() }
            : { currentPassword, deviceSecret: deviceSecret() },
        );
      } catch (cause) {
        setError(emailFailureMessage(cause instanceof AuthError ? cause.reason : ''));
        return null;
      } finally {
        setBusy(false);
      }
    },
    [accessToken],
  );

  const claimRecovery = useCallback(async (code: string): Promise<boolean> => {
    setBusy(true);
    setError(null);
    try {
      const baseUrl = resolveServerUrl(
        import.meta.env.VITE_SERVER_URL,
        window.location.hostname,
        currentPageLocation(),
      );
      /*
        Presenter le code et rattacher l appareil, en UN geste.

        Le navigateur garde son propre secret, qui appartient encore au compte
        invite qu on abandonne. On en tire un NEUF, que le serveur rattache au
        compte retrouve dans la meme requete que le code — il n existe plus de
        route de rattachement a part, qu un jeton vole suffisait a appeler. Le
        neuf n est range qu une fois accepte : un echec laisse l ancien en place.
      */
      const session = await joinWithFreshSecret((secret) =>
        claimRecoveryCode(baseUrl, code, secret),
      );

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

  /*
    L adresse rattachee, relue a chaque nouvelle session : apres un code de
    recuperation ou une connexion par email, ce n est plus le meme compte.
  */
  useEffect(() => {
    if (accessToken === null) {
      setEmail(null);
      return;
    }
    let cancelled = false;
    fetchEmailStatus(serverUrl(), accessToken).then(
      (status) => {
        if (!cancelled) setEmail(status);
      },
      () => {
        // Sans reponse, les Reglages proposent simplement de rattacher une
        // adresse ; le serveur dira EMAIL_ALREADY_LINKED si c est deja fait.
        if (!cancelled) setEmail(null);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [accessToken]);

  const linkEmail = useCallback(
    async (address: string, password: string): Promise<boolean> => {
      if (accessToken === null) {
        setError(MESSAGES.UNREACHABLE ?? null);
        return false;
      }
      setBusy(true);
      setError(null);
      try {
        setEmail(
          await requestEmailLink(serverUrl(), accessToken, address, password, deviceSecret()),
        );
        return true;
      } catch (cause) {
        setError(emailFailureMessage(cause instanceof AuthError ? cause.reason : ''));
        return false;
      } finally {
        setBusy(false);
      }
    },
    [accessToken],
  );

  /** Prend la session d un compte retrouve : nom, jeton, phase. */
  const adopt = useCallback((session: SessionResponse): void => {
    const next = { playerId: session.player.id, displayName: session.player.displayName };
    saveIdentity(next);
    setIdentity(next);
    setAccessToken(session.accessToken);
    setPhase('ready');
  }, []);

  const loginEmail = useCallback(
    async (address: string, password: string): Promise<boolean> => {
      setBusy(true);
      setError(null);
      try {
        const baseUrl = serverUrl();
        // Meme geste qu avec un code : la preuve et le rattachement d un secret
        // neuf ensemble, range seulement une fois accepte.
        const session = await joinWithFreshSecret((secret) =>
          loginWithEmail(baseUrl, address, password, secret),
        );
        adopt(session);
        return true;
      } catch (cause) {
        setError(emailFailureMessage(cause instanceof AuthError ? cause.reason : ''));
        return false;
      } finally {
        setBusy(false);
      }
    },
    [adopt],
  );

  const changePassword = useCallback(
    async (proof: PasswordProof, newPassword: string): Promise<boolean> => {
      if (accessToken === null) {
        setError(MESSAGES.UNREACHABLE ?? null);
        return false;
      }
      setBusy(true);
      setError(null);
      try {
        /*
          Le serveur invalide toutes les sessions, la notre comprise, et detache
          tous les appareils sauf celui-ci. Il rend une session fraiche pour
          CET appareil : on l adopte, sans quoi le prochain appel echouerait et
          le joueur croirait avoir ete deconnecte par son propre geste.
        */
        adopt(
          await requestPasswordChange(serverUrl(), accessToken, proof, newPassword, {
            deviceSecret: deviceSecret(),
          }),
        );
        return true;
      } catch (cause) {
        setError(emailFailureMessage(cause instanceof AuthError ? cause.reason : ''));
        return false;
      } finally {
        setBusy(false);
      }
    },
    [accessToken, adopt],
  );

  return {
    phase,
    identity,
    accessToken,
    error,
    busy,
    rename,
    issueRecovery,
    claimRecovery,
    email,
    linkEmail,
    loginEmail,
    changePassword,
  };
}
