import { useCallback, useEffect, useRef, useState } from 'react';
import { AdminApiError } from '../api/client.js';

/** Une lecture du serveur : en cours, echouee, ou prete (et peut-etre en train de se rafraichir). */
export type Resource<T> =
  | { readonly status: 'loading' }
  | { readonly status: 'error'; readonly error: string }
  | { readonly status: 'ready'; readonly data: T; readonly refreshing: boolean };

export const messageOf = (error: unknown): string =>
  error instanceof AdminApiError
    ? error.message
    : error instanceof Error
      ? error.message
      : 'Erreur inconnue.';

/**
 * Charge une ressource, la recharge a la demande et, si `intervalMs` est
 * donne, periodiquement. Un rafraichissement garde les donnees affichees :
 * une page qui clignote a chaque relecture ne se lit pas.
 */
export function useResource<T>(
  load: () => Promise<T>,
  key: string,
  intervalMs?: number,
): { readonly state: Resource<T>; readonly reload: () => void } {
  const [state, setState] = useState<Resource<T>>({ status: 'loading' });
  const loadRef = useRef(load);
  loadRef.current = load;
  const generation = useRef(0);

  const run = useCallback((soft: boolean) => {
    const mine = ++generation.current;
    setState((previous) =>
      soft && previous.status === 'ready'
        ? { ...previous, refreshing: true }
        : { status: 'loading' },
    );
    loadRef.current().then(
      (data) => {
        if (mine === generation.current) setState({ status: 'ready', data, refreshing: false });
      },
      (error: unknown) => {
        if (mine === generation.current) setState({ status: 'error', error: messageOf(error) });
      },
    );
  }, []);

  useEffect(() => {
    run(false);
    if (intervalMs === undefined) return undefined;
    const timer = window.setInterval(() => run(true), intervalMs);
    return () => {
      window.clearInterval(timer);
      generation.current++;
    };
  }, [key, intervalMs, run]);

  const reload = useCallback(() => run(true), [run]);
  return { state, reload };
}

/** Le resultat d'une ecriture, affiche jusqu'a la suivante. */
export type Notice = { readonly kind: 'success' | 'error'; readonly text: string } | null;

/**
 * Execute une ecriture : un seul geste a la fois, resultat affiche (succes ou
 * erreur du serveur avec son code), puis rafraichissement de la vue.
 */
export function useWrite(onDone: () => void): {
  readonly busy: boolean;
  readonly notice: Notice;
  readonly run: (action: () => Promise<void>, success: string) => Promise<boolean>;
  readonly dismiss: () => void;
} {
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<Notice>(null);
  const run = useCallback(
    async (action: () => Promise<void>, success: string) => {
      setBusy(true);
      setNotice(null);
      try {
        await action();
        setNotice({ kind: 'success', text: success });
        return true;
      } catch (error) {
        setNotice({ kind: 'error', text: messageOf(error) });
        return false;
      } finally {
        setBusy(false);
        onDone();
      }
    },
    [onDone],
  );
  const dismiss = useCallback(() => setNotice(null), []);
  return { busy, notice, run, dismiss };
}

/** Une valeur qui ne suit la saisie qu'apres un temps de repos. */
export function useDebounced<T>(value: T, delayMs: number): T {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const timer = window.setTimeout(() => setSettled(value), delayMs);
    return () => window.clearTimeout(timer);
  }, [value, delayMs]);
  return settled;
}
