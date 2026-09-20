import type { Choice, RechargeTap } from '@aura/rules';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { ArenaControls } from '../arena/useArena.js';
import { present } from '../match/presentation.js';
import { createSoloMatch, type SoloMatch } from '../match/solo.js';
import { viewOfSolo, type MatchView } from '../match/view.js';
import { cuesForTransition } from '../audio/matchCues.js';
import type { AudioControls } from './useAudio.js';
import type { MatchActions } from './MatchScreen.jsx';
import type { Look } from './wardrobe.js';

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
      arena.presentation.current = present(match.state, looks, {
        showOutcome: match.state.phase === 'reveal',
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
    lock: useCallback((choice: Choice, _chargeAtMs: number, tapAtMs: number) => {
      // Le moteur local n a que faire de l instant d armement : il ne sert
      // qu au serveur, pour juger de la plausibilite du geste.
      return matchRef.current?.lock(choice, tapAtMs, tapAtMs) ?? false;
    }, []),
  };

  const match = matchRef.current;
  return { view: viewOfSolo(match), actions, nowMs };
}
