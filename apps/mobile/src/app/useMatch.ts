import type { Choice, RechargeTap } from '@aura/rules';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { ArenaControls } from '../arena/useArena.js';
import { present } from '../match/presentation.js';
import { createSoloMatch, type SoloMatch } from '../match/solo.js';
import { viewOfSolo, type MatchView } from '../match/view.js';
import { renderKey } from '../ui/renderKey.js';
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
  /**
   * Horloge vive du match.
   *
   * L ecran la lit a chaque image pour peindre l aiguille, les orbes et le
   * compte a rebours, et a chaque geste pour le dater. `nowMs` ne vaut plus
   * que pour le premier rendu : entre deux rendus, il ne bouge plus.
   */
  readonly clock: () => number;
  /**
   * Relance une partie, sur une nouvelle graine.
   *
   * Une NOUVELLE partie, pas la meme remise a zero : rejouer la meme graine
   * rendrait la sequence d orbes et la jauge identiques, et le joueur
   * apprendrait le tirage au lieu d apprendre le jeu.
   */
  readonly restart: () => void;
}

/** Une graine par partie. L horloge suffit : rien ici n a besoin d etre secret. */
const freshSeed = (): string => `solo-${String(Date.now())}-${String(Math.random()).slice(2, 8)}`;

export function useSoloMatch(
  looks: Readonly<Record<'a' | 'b', Look>>,
  arena: ArenaControls,
  audio: AudioControls,
): MatchSession {
  const matchRef = useRef<SoloMatch | null>(null);
  matchRef.current ??= createSoloMatch({
    seed: freshSeed(),
    opponent: 'calm',
    startedAtMs: 0,
  });

  const startedAt = useRef(performance.now());

  /** Horloge du match : `performance.now()` moins le debut de la partie. */
  const clock = useCallback((): number => performance.now() - startedAt.current, []);

  /**
   * Dernier etat deja dessine par React.
   *
   * La boucle appelait `setNow(now)` a chaque image : un rendu complet de
   * l ecran de match soixante fois par seconde, c est-a-dire trente boutons
   * redessines pour deplacer une aiguille. `MatchScreen` peint desormais ce
   * qui bouge dans sa propre boucle ; ici on ne redessine que quand la vue
   * change vraiment de contenu.
   */
  const drawn = useRef('');
  const [, force] = useState(0);

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

      const key = renderKey(seen);
      if (key !== drawn.current) {
        drawn.current = key;
        force((count) => count + 1);
      }
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

  const restart = useCallback(() => {
    matchRef.current = createSoloMatch({
      seed: freshSeed(),
      opponent: 'calm',
      startedAtMs: 0,
    });
    // L horloge de phase repart avec la partie : sans cela, la premiere phase
    // de la revanche se croirait deja finie et defilerait d un coup.
    startedAt.current = performance.now();
    // Et rien de la partie precedente ne doit sonner : le dernier resultat vu
    // est celui d un match qui n existe plus.
    soundedRef.current = null;
    // La vue de la partie precedente n a plus rien a voir avec la nouvelle :
    // on oublie la cle pour que le premier etat de la revanche se dessine.
    drawn.current = '';
    force((count) => count + 1);
  }, []);

  const match = matchRef.current;
  return { view: viewOfSolo(match), actions, nowMs: clock(), clock, restart };
}
