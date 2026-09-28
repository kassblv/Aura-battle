import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AdminApiError, createAdminApi } from '../api/client.js';
import { AuditPage } from '../pages/Audit.js';
import { DashboardPage } from '../pages/Dashboard.js';
import { EventsPage } from '../pages/Events.js';
import { ExperimentsPage } from '../pages/Experiments.js';
import { LoginView } from '../pages/Login.js';
import { PlayerDetailPage } from '../pages/PlayerDetail.js';
import { PlayersPage } from '../pages/Players.js';
import { Empty } from '../ui/states.js';
import { messageOf } from './resource.js';
import { parseRoute, sectionOf, type Route } from './router.js';
import { clearToken, readToken, saveToken } from './session.js';
import { Shell } from './Shell.js';

function useRoute(): Route {
  const [route, setRoute] = useState(() => parseRoute(window.location.hash));
  useEffect(() => {
    const onChange = () => {
      setRoute(parseRoute(window.location.hash));
      window.scrollTo(0, 0);
    };
    window.addEventListener('hashchange', onChange);
    return () => window.removeEventListener('hashchange', onChange);
  }, []);
  return route;
}

/** Le message de l'ecran de connexion pour un refus a l'entree. */
export function loginError(error: unknown): string {
  if (error instanceof AdminApiError) {
    if (error.kind === 'unauthorized') return 'Secret refusé.';
    if (error.kind === 'not-found') {
      return 'Panneau désactivé : aucun secret d’administration n’est configuré sur ce serveur.';
    }
  }
  return messageOf(error);
}

export function App() {
  const route = useRoute();
  const [token, setToken] = useState<string | null>(() => readToken());
  const [loginBusy, setLoginBusy] = useState(false);
  const [loginMessage, setLoginMessage] = useState<string | null>(null);
  // Le secret en cours d'essai, lu par le client pendant la verification.
  const pending = useRef<string | null>(null);

  const logout = useCallback((message: string | null = null) => {
    clearToken();
    pending.current = null;
    setToken(null);
    setLoginMessage(message);
  }, []);

  const api = useMemo(
    () =>
      createAdminApi({
        fetch: (input, init) => window.fetch(input, init),
        token: () => pending.current ?? readToken() ?? token,
        onUnauthorized: () => {
          if (pending.current === null) logout('Secret refusé ou expiré : reconnecte-toi.');
        },
      }),
    [token, logout],
  );

  const login = async (secret: string) => {
    setLoginBusy(true);
    setLoginMessage(null);
    pending.current = secret;
    try {
      await api.status();
      saveToken(secret);
      setToken(secret);
    } catch (error) {
      setLoginMessage(loginError(error));
    } finally {
      pending.current = null;
      setLoginBusy(false);
    }
  };

  if (token === null) {
    return <LoginView busy={loginBusy} error={loginMessage} onSubmit={(s) => void login(s)} />;
  }

  return (
    <Shell section={sectionOf(route)} onLogout={() => logout()}>
      {route.name === 'dashboard' ? (
        <DashboardPage api={api} />
      ) : route.name === 'experiments' ? (
        <ExperimentsPage api={api} />
      ) : route.name === 'events' ? (
        <EventsPage api={api} />
      ) : route.name === 'players' ? (
        <PlayersPage api={api} />
      ) : route.name === 'player' ? (
        <PlayerDetailPage key={route.id} api={api} id={route.id} />
      ) : route.name === 'audit' ? (
        <AuditPage api={api} />
      ) : (
        <div className="page">
          <h1 className="page__title">Page introuvable</h1>
          <Empty>
            Cette adresse ne mène nulle part. <a href="#/">Retour au tableau de bord</a>.
          </Empty>
        </div>
      )}
    </Shell>
  );
}
