import { useCallback, useEffect, useRef, useState } from 'react';
import type { Choice, RechargeTap } from '@aura/rules';
import { createGameClient, type GameClient } from '../net/client.js';
import { createSocketTransport } from '../net/socketTransport.js';
import { createOnlineMatch, type OnlineMatch } from '../match/online.js';
import { viewOfOnline, type MatchView } from '../match/view.js';
import { resolveServerUrl } from '../net/serverUrl.js';
import type { ConnectionStatus } from '../net/connection.js';
import type { MatchActions } from './MatchScreen.jsx';

/**
 * Le duel en ligne, du lien jusqu au match.
 *
 * Tout ce qui se decide vit ailleurs : `client.ts` valide, `connection.ts`
 * reprend, `online.ts` traduit, `view.ts` met en forme. Ce hook ne fait que
 * tenir ces objets en vie le temps d un montage React et donner a l ecran une
 * image rafraichie a chaque image.
 */

/** Rythme des `ping` : assez souvent pour suivre la derive, assez rare pour ne rien couter. */
const PING_EVERY_MS = 5_000;

export interface OnlineSession {
  readonly status: ConnectionStatus;
  readonly view: MatchView;
  readonly actions: MatchActions;
  readonly nowMs: number;
  readonly opponentName: string;
  /** Code d invitation cree par ce joueur, quand il en a demande un. */
  readonly inviteCode: string | null;
  readonly error: string | null;
  readonly createInvite: () => void;
  readonly joinInvite: (code: string) => void;
  /** Annonce qu on est pret : le serveur n ouvre la manche que quand les deux le sont. */
  readonly ready: () => void;
}

export function useOnlineMatch(accessToken: string | null): OnlineSession {
  const clientRef = useRef<GameClient | null>(null);
  const matchRef = useRef<OnlineMatch | null>(null);
  const [, force] = useState(0);
  const [inviteCode, setInviteCode] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const nowRef = useRef(0);

  useEffect(() => {
    if (accessToken === null) return;

    const url = resolveServerUrl(import.meta.env.VITE_SERVER_URL, window.location.hostname);
    const client = createGameClient(createSocketTransport({ url, accessToken }));
    const match = createOnlineMatch(client);
    clientRef.current = client;
    matchRef.current = match;

    const offInvite = client.on('invite:created', (data) => {
      setInviteCode(data.code);
    });
    const offError = client.on('error', (data) => {
      setError(data.message);
    });
    /**
     * Le match trouve efface le code : le garder afficherait une invitation
     * deja consommee, que le joueur suivant essaierait en vain.
     */
    const offFound = client.on('match:found', () => {
      setInviteCode(null);
      setError(null);
      client.send('match:ready', { matchId: match.state.matchId ?? '' });
    });

    const ping = setInterval(() => {
      client.ping();
    }, PING_EVERY_MS);
    client.ping();

    let frame = 0;
    const tick = (): void => {
      frame = requestAnimationFrame(tick);
      nowRef.current = performance.now();
      force((n) => n + 1);
    };
    frame = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(frame);
      clearInterval(ping);
      offInvite();
      offError();
      offFound();
      client.close();
      clientRef.current = null;
      matchRef.current = null;
    };
  }, [accessToken]);

  const actions: MatchActions = {
    tap: useCallback((taps: readonly RechargeTap[]) => {
      matchRef.current?.tap(taps);
    }, []),
    lock: useCallback((choice: Choice, chargeAtMs: number, tapAtMs: number) => {
      matchRef.current?.lock(choice, chargeAtMs, tapAtMs);
      // Le serveur tranche : on ne sait pas encore s il accepte, et pretendre
      // le contraire afficherait un verrouillage qui n a pas eu lieu.
      return true;
    }, []),
  };

  const createInvite = useCallback(() => {
    setError(null);
    clientRef.current?.send('invite:create', {});
  }, []);

  const joinInvite = useCallback((code: string) => {
    setError(null);
    clientRef.current?.send('invite:join', { code: code.trim().toUpperCase() });
  }, []);

  const ready = useCallback(() => {
    const matchId = matchRef.current?.state.matchId;
    if (matchId !== undefined && matchId !== null) {
      clientRef.current?.send('match:ready', { matchId });
    }
  }, []);

  const match = matchRef.current;
  return {
    status: clientRef.current?.connection.status ?? 'offline',
    view: match === null ? EMPTY_VIEW : viewOfOnline(match),
    actions,
    nowMs: nowRef.current,
    opponentName: match?.state.opponentName ?? 'Adversaire',
    inviteCode,
    error,
    createInvite,
    joinInvite,
    ready,
  };
}

/** Avant toute connexion : rien n est connu, et rien ne doit etre invente. */
const EMPTY_VIEW: MatchView = {
  phase: 'idle',
  round: 1,
  phaseEndsAtMs: 0,
  phaseDurationMs: 1,
  me: { energy: null, roundsWon: 0 },
  opponent: { energy: null, roundsWon: 0 },
  orbs: [],
  taps: [],
  meterPeriodMs: 0,
  opponentLocked: false,
  lastRound: null,
  ended: null,
};
