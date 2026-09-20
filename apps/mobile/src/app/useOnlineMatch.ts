import { useCallback, useEffect, useRef, useState } from 'react';
import type { Choice, RechargeTap } from '@aura/rules';
import { createGameClient, type GameClient } from '../net/client.js';
import { createSocketTransport } from '../net/socketTransport.js';
import { createOnlineMatch, type OnlineMatch, type OnlinePhase } from '../match/online.js';
import { presentOnline } from '../match/onlinePresentation.js';
import { cuesForTransition } from '../audio/matchCues.js';
import { viewOfOnline, type MatchView } from '../match/view.js';
import { resolveServerUrl } from '../net/serverUrl.js';
import type { ConnectionStatus } from '../net/connection.js';
import type { ArenaControls } from '../arena/useArena.js';
import type { AudioControls } from './useAudio.js';
import type { Seat } from '@aura/rules';
import type { Look } from './wardrobe.js';
import type { MatchActions } from './MatchScreen.jsx';

/**
 * Le duel en ligne, du lien jusqu au match.
 *
 * Tout ce qui se decide vit ailleurs : `client.ts` valide, `connection.ts`
 * reprend, `online.ts` traduit, `view.ts` met en forme. Ce hook ne fait que
 * tenir ces objets en vie le temps d un montage React et donner a l ecran une
 * image rafraichie a chaque image.
 */

/**
 * Delai entre le debut de la revelation et le verdict.
 *
 * Basculer sur la joie et l encaissement des la premiere image de `reveal`
 * escamoterait la danse : le joueur verrait le resultat sans avoir vu ce qui l
 * a produit, et la manche perdrait son moment. On laisse donc les deux
 * mouvements se jouer, puis le verdict tombe.
 */
const VERDICT_AFTER_MS = 1_400;

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

export function useOnlineMatch(
  accessToken: string | null,
  /**
   * Nom affiche du joueur.
   *
   * Il n'est pas envoye — le serveur ne croit rien de ce que le client raconte
   * de lui-meme. Il sert de **cle de session** : le serveur resout le nom au
   * moment ou la socket se connecte, donc un renommage posterieur laisserait
   * une socket qui s'annonce sous l'ancien nom. Le changer refait le lien.
   *
   * Le parcours de premiere partie tombe pile dedans : le client se connecte
   * des que la session est prete, et l'ecran d'inscription ne s'affiche
   * qu'ensuite. Sans cette dependance, tout premier duel annoncerait
   * « Invite 7603 » a l'adversaire.
   *
   * Refaire la socket coupe un match en cours : le renommage ne doit donc
   * rester joignable que hors match, ce qui est le cas aujourd'hui (il n'existe
   * que dans l'ecran d'inscription).
   */
  displayName: string | null,
  looks: Readonly<Record<Seat, Look>>,
  arena: ArenaControls,
  audio: AudioControls,
): OnlineSession {
  const clientRef = useRef<GameClient | null>(null);
  const matchRef = useRef<OnlineMatch | null>(null);
  const [, force] = useState(0);
  const [inviteCode, setInviteCode] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const nowRef = useRef(0);

  /**
   * Les tenues traversent la boucle par une reference, pas par la dependance
   * de l effet : reconstruire la socket parce que le joueur a change de veste
   * couperait le duel en cours.
   */
  const looksRef = useRef(looks);
  looksRef.current = looks;

  /** Debut de la phase courante, en heure locale, pour dater la choregraphie. */
  const phaseRef = useRef<OnlinePhase>('idle');
  const phaseStartedAt = useRef(0);

  /** Derniere vue deja sonnee : le son se declenche sur un bord, pas sur un etat. */
  const soundedRef = useRef<MatchView>(EMPTY_VIEW);

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

      /**
       * L arene suit le duel en ligne comme elle suit le solo.
       *
       * C est le pendant de `useSoloMatch` : sans lui, l arene reste la
       * vitrine de l accueil — un seul combattant, fige dans sa pose — pendant
       * que le HUD, lui, joue le match. Les deux modes produisent la meme
       * scene ou le duel en ligne se joue a un autre jeu que l entrainement.
       */
      const state = match.state;
      if (state.phase !== phaseRef.current) {
        phaseRef.current = state.phase;
        phaseStartedAt.current = nowRef.current;
      }
      /**
       * Le son suit le meme fil que l image, et depuis le meme instantane.
       *
       * Les deux partent donc du meme fait serveur : ils ne peuvent pas
       * raconter deux histoires differentes. `cuesForTransition` compare l etat
       * precedent au courant — sonner l etat rejouerait le meme fracas a
       * chaque image.
       */
      const seen = viewOfOnline(match);
      for (const cue of cuesForTransition(soundedRef.current, seen)) {
        audio.engine.cue(cue);
      }
      soundedRef.current = seen;

      /**
       * On ne pilote l arene que pendant un duel, et on n ecrit rien sinon.
       *
       * Ce hook vit aussi longtemps que l application : sa boucle tourne donc
       * AUSSI pendant un match solo. Y poser `showcase = !live` sans condition
       * remettait la vitrine soixante fois par seconde par-dessus le solo, qui
       * se retrouvait avec un seul combattant au centre — exactement le defaut
       * qu on venait de corriger en ligne, dans l autre sens.
       *
       * Regle : l arene appartient a qui joue. Au repos, on se tait.
       */
      if (state.phase !== 'idle') {
        arena.showcase.current = false;
        const intoPhase = nowRef.current - phaseStartedAt.current;
        arena.presentation.current = presentOnline(state, looksRef.current, {
          showOutcome:
            state.phase === 'ended' || (state.phase === 'reveal' && intoPhase >= VERDICT_AFTER_MS),
        });
      }

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
  }, [accessToken, displayName, arena, audio]);

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
