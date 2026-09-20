import type { Choice, RechargeTap } from '@aura/rules';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { ArenaControls } from '../arena/useArena.js';
import { present } from '../match/presentation.js';
import { createSoloMatch, type SoloMatch } from '../match/solo.js';
import { viewOfSolo, type MatchView } from '../match/view.js';
import { cuesForTransition } from '../audio/matchCues.js';
import type { AudioControls } from './useAudio.js';
import type { MatchActions } from './MatchScreen.jsx';
import { danceFor, type Look } from './wardrobe.js';

/**
 * Fait tourner un match solo et le donne a l ecran.
 *
 * Le pilote en ligne (`online.ts`) produit la meme vue : l ecran n a donc pas a
 * savoir contre qui il joue, et ce hook a un jumeau exact du cote reseau.
 */

export interface MatchSession {
  readonly view: MatchView;
  readonly actions: MatchActions;
  readonly nowMs: number;
}

export function useSoloMatch(
  looks: Readonly<Record<'a' | 'b', Look>>,
  arena: ArenaControls,
  audio: AudioControls,
): MatchSession {
  const matchRef = useRef<SoloMatch | null>(null);
  matchRef.current ??= createSoloMatch({
    seed: `solo-${String(Date.now())}`,
    opponent: 'calm',
    startedAtMs: 0,
  });

  const startedAt = useRef(performance.now());
  const [nowMs, setNow] = useState(0);

  /**
   * Derniere vue deja sonnee.
   *
   * Le solo passe par exactement la meme fonction que le duel en ligne. C est
   * le point : l arene avait deja ete pilotee par un seul des deux modes, et le
   * duel en ligne s etait retrouve sans adversaire a l ecran.
   */
  const soundedRef = useRef<MatchView | null>(null);

  useEffect(() => {
    arena.showcase.current = false;
    let frame = 0;
    const tick = (): void => {
      frame = requestAnimationFrame(tick);
      const match = matchRef.current;
      if (match === null) return;
      const now = performance.now() - startedAt.current;
      match.advanceTo(now);
      /**
       * La danse equipee pour le mouvement joue.
       *
       * Sans ce passage, acheter une danse n aurait aucun effet : l arene
       * rejouerait toujours l animation offerte du mouvement. `animationFor`
       * ignore de lui-meme un skin qui appartient a un autre mouvement.
       */
      const mine = match.state.seats.a.moves.at(-1);
      const skin = mine === undefined ? undefined : danceFor(looks.a, mine);
      arena.presentation.current = present(match.state, looks, {
        showOutcome: match.state.phase === 'reveal',
        ...(skin === undefined ? {} : { skins: { a: skin } }),
      });

      const seen = viewOfSolo(match);
      if (soundedRef.current !== null) {
        for (const cue of cuesForTransition(soundedRef.current, seen)) {
          audio.engine.cue(cue);
        }
      }
      soundedRef.current = seen;

      setNow(now);
    };
    frame = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(frame);
      arena.showcase.current = true;
    };
  }, [arena, audio, looks]);

  const actions: MatchActions = {
    tap: useCallback((taps: readonly RechargeTap[], inPhaseMs: number) => {
      matchRef.current?.tap(taps, inPhaseMs);
    }, []),
    lock: useCallback((choice: Choice, chargeAtMs: number, tapAtMs: number) => {
      /**
       * Le moteur veut l ECART entre l armement et l appui, pas l instant de
       * l appui dans la phase — exactement ce que `match.gateway.ts` calcule
       * avant d appeler `lockChoice`. Le commentaire precedent pretendait le
       * contraire et coutait deux defauts :
       *
       * 1. Le solo notait `cursorPosition(tapAt)` la ou le serveur note
       *    `cursorPosition(tapAt - chargeAt)` : le meme geste ne valait pas la
       *    meme chose selon le mode.
       * 2. `evaluateTiming` rate tout ecart superieur a `maxChargeMs` (6 s), et
       *    la phase de choix dure 15 s. Tout verrouillage au-dela de six
       *    secondes de reflexion etait donc un rate automatique, quelle que
       *    soit la visee.
       */
      return matchRef.current?.lock(choice, tapAtMs - chargeAtMs, tapAtMs) ?? false;
    }, []),
  };

  const match = matchRef.current;
  return { view: viewOfSolo(match), actions, nowMs };
}
