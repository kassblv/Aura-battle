import { useCallback, useEffect, useRef, useState } from 'react';
import type { ArenaFrameListener } from '../arena/useArena.js';
import type { RevealScene } from '../app/reveal.js';
import type { MatchView } from '../match/view.js';
import type { ClipStatus } from './button.js';
import { drawClipFrame, readClipTheme, type ClipTheme } from './composer.js';
import { CLIP_HEIGHT, CLIP_WIDTH, clipLayout, type ClipOutcome } from './layout.js';
import { CLIP_STOP_AT_MS, clipPolicy, INITIAL_CLIP_POLICY } from './policy.js';
import { clipFrameDue, createClipRecorder, type ClipRecorder } from './recorder.js';

/**
 * Filme la revelation des manches gagnees (ADR 0017).
 *
 * Seul module du clip qui touche React et le navigateur : il n est donc pas
 * teste, comme `useArena`. Tout ce qui se decide vit ailleurs — `policy.ts`
 * dit quand filmer, `layout.ts` quoi montrer, `composer.ts` comment le peindre
 * — et se teste sans canvas.
 *
 * On ne s abonne aux images de l arene QUE pendant un enregistrement : le
 * reste du match, la boucle de l arene ne paie rien pour le clip.
 */

export type ArenaFrames = (listener: ArenaFrameListener) => () => void;

export interface RevealClipInput {
  /** Absent : pas d arene, pas de clip. */
  readonly frames: ArenaFrames | undefined;
  readonly view: MatchView;
  /** Temps ecoule dans la phase, a l instant de l appel. */
  readonly inPhaseNow: () => number;
  readonly scene: RevealScene | null;
}

export interface RevealClip {
  readonly status: ClipStatus;
  readonly blob: Blob | null;
}

interface Recording {
  readonly recorder: ClipRecorder;
  readonly unsubscribe: () => void;
}

const NONE: RevealClip = { status: 'none', blob: null };

export function useRevealClip(input: RevealClipInput): RevealClip {
  const [clip, setClip] = useState<RevealClip>(NONE);
  const inputRef = useRef(input);
  inputRef.current = input;

  const policy = useRef(INITIAL_CLIP_POLICY);
  const recording = useRef<Recording | null>(null);
  /** Le dernier clip garde : il reste proposable pendant qu un autre se filme. */
  const kept = useRef<Blob | null>(null);
  /** Incremente a chaque abandon : un encodage en retard ne ressuscite rien. */
  const generation = useRef(0);
  const stopTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const surface = useRef<{ canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } | null>(null);
  const theme = useRef<ClipTheme | null>(null);

  const clearTimer = (): void => {
    if (stopTimer.current !== null) clearTimeout(stopTimer.current);
    stopTimer.current = null;
  };

  const settle = (): void => {
    setClip(kept.current === null ? NONE : { status: 'ready', blob: kept.current });
  };

  const abort = (): void => {
    clearTimer();
    const current = recording.current;
    recording.current = null;
    if (current === null) return;
    current.unsubscribe();
    current.recorder.cancel();
  };

  const step = useCallback((): void => {
    const { view, inPhaseNow, frames, scene } = inputRef.current;
    const inPhaseMs = inPhaseNow();
    const last = view.lastRound;
    const next = clipPolicy(policy.current, {
      phase: view.phase,
      round: view.round,
      inPhaseMs,
      last: last === null ? null : { round: last.round, winner: last.winner },
    });
    policy.current = next.state;

    for (const command of next.commands) {
      switch (command) {
        case 'start': {
          if (frames === undefined || scene === null || last === null) break;
          surface.current ??= createSurface();
          const target = surface.current;
          if (target === null) break;
          theme.current ??= readClipTheme();
          const palette = theme.current;
          const recorder = createClipRecorder(target.canvas);
          const outcome: ClipOutcome = {
            winner: last.winner,
            myScore: last.myScore,
            opponentScore: last.opponentScore,
          };
          // `now` est dans le repere de `performance.now()`, comme ceci.
          const revealStart = performance.now() - inPhaseMs;
          let lastDrawn: number | null = null;
          const unsubscribe = frames((arena, now) => {
            // Trente images par seconde, comme la video : pas une de plus.
            if (!clipFrameDue(lastDrawn, now)) return;
            lastDrawn = now;
            const layout = clipLayout({
              scene,
              outcome,
              arena: { width: arena.width, height: arena.height },
              elapsedMs: now - revealStart,
            });
            drawClipFrame(target.ctx, arena, layout, palette);
          });
          // La premiere image capturee precede la premiere image de l arene :
          // le fond plutot que du noir.
          target.ctx.fillStyle = palette.bg;
          target.ctx.fillRect(0, 0, CLIP_WIDTH, CLIP_HEIGHT);
          if (!recorder.start()) {
            unsubscribe();
            break;
          }
          recording.current = { recorder, unsubscribe };
          setClip({ status: 'recording', blob: kept.current });
          clearTimer();
          stopTimer.current = setTimeout(step, Math.max(0, CLIP_STOP_AT_MS - inPhaseMs) + 16);
          break;
        }
        case 'stop': {
          clearTimer();
          const current = recording.current;
          recording.current = null;
          if (current === null) break;
          current.unsubscribe();
          const mine = generation.current;
          setClip({ status: 'encoding', blob: kept.current });
          void current.recorder.stop().then((blob) => {
            if (generation.current !== mine) return;
            // Un encodage rate garde le clip precedent : il reste le meilleur.
            if (blob !== null) kept.current = blob;
            settle();
          });
          break;
        }
        case 'cancel':
          generation.current += 1;
          abort();
          break;
        case 'discard':
          generation.current += 1;
          kept.current = null;
          setClip(NONE);
          break;
      }
    }
  }, []);

  const { phase, round, lastRound } = input.view;
  useEffect(() => {
    step();
  }, [phase, round, lastRound, step]);

  // L ecran quitte : rien ne doit continuer a filmer ni a peindre.
  useEffect(
    () => () => {
      generation.current += 1;
      abort();
    },
    [],
  );

  return clip;
}

function createSurface(): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } | null {
  if (typeof document === 'undefined') return null;
  const canvas = document.createElement('canvas');
  canvas.width = CLIP_WIDTH;
  canvas.height = CLIP_HEIGHT;
  // Opaque : l encodeur n a pas a gerer de transparence.
  const ctx = canvas.getContext('2d', { alpha: false });
  return ctx === null ? null : { canvas, ctx };
}
