import type { Choice, RechargeTap } from '@aura/rules';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { ArenaControls } from '../arena/useArena.js';
import { present } from '../match/presentation.js';
import { withChoicePreview, type ChoicePreview } from '../match/choicePreview.js';
import { outcomeShown } from '../arena/round.js';
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
  /**
   * L horloge vive, dans le meme repere que `nowMs`.
   *
   * `nowMs` est fige au dernier rendu ; un geste date avec lui serait date
   * faux, et le serveur confronte chaque instant declare a son instant
   * d arrivee (docs/06). L ecran lit donc celle-ci, pas l autre.
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
  /** L apercu du choix en cours, pour l arene. Voir `withChoicePreview`. */
  readonly preview: (next: ChoicePreview | null) => void;
}

/** Une graine par partie. L horloge suffit : rien ici n a besoin d etre secret. */
const freshSeed = (): string => `solo-${String(Date.now())}-${String(Math.random()).slice(2, 8)}`;

export function useSoloMatch(
  looks: Readonly<Record<'a' | 'b', Look>>,
  arena: ArenaControls,
  audio: AudioControls,
  /**
   * Ce que le joueur possede, pour l effet d aura de son palier.
   *
   * En ligne, c est le serveur qui resout l apparence et l envoie avec le
   * resultat. Hors ligne il n y a personne d autre : sans cette liste, un skin
   * achete ne se verrait jamais en solo — c est-a-dire souvent la premiere
   * partie que quelqu un joue apres l avoir paye.
   *
   * Seulement le siege A : l IA ne possede rien, et lui preter l inventaire du
   * joueur donnerait a celui-ci l impression que son achat est distribue a
   * tout le monde.
   */
  ownedEffects: Iterable<string> = [],
): MatchSession {
  const matchRef = useRef<SoloMatch | null>(null);
  matchRef.current ??= createSoloMatch({
    seed: freshSeed(),
    opponent: 'calm',
    startedAtMs: 0,
  });

  const startedAt = useRef(performance.now());

  /*
    Lue par une REF, pas par une dependance d effet.

    La liste change d identite a chaque rendu : la mettre dans les dependances
    relancerait la boucle d animation — `cancelAnimationFrame` puis un nouveau
    `requestAnimationFrame` — a chaque fois que React repasse. Une ref donne la
    valeur du moment sans toucher au cycle de vie de la boucle.
  */
  const ownedEffectsRef = useRef(ownedEffects);
  ownedEffectsRef.current = ownedEffects;
  const [nowMs, setNow] = useState(0);
  const previewRef = useRef<ChoicePreview | null>(null);
  /** Debut de la phase courante, pour savoir ou en est la revelation. */
  const phaseRef = useRef<{ phase: string; since: number }>({ phase: '', since: 0 });

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
      if (phaseRef.current.phase !== match.state.phase) {
        phaseRef.current = { phase: match.state.phase, since: now };
      }
      /*
        La joie et l encaissement attendent le contact des faisceaux, comme en
        ligne. Le solo basculait des la premiere image de la revelation : les
        deux danses ne s y voyaient jamais.
      */
      const scene = present(match.state, looks, {
        showOutcome: outcomeShown(match.state.phase, now - phaseRef.current.since),
        ownedEffects: { a: ownedEffectsRef.current },
        ...(skin === undefined ? {} : { skins: { a: skin } }),
      });
      arena.presentation.current = withChoicePreview(
        scene,
        match.state.phase,
        previewRef.current,
        ownedEffectsRef.current,
      );

      const seen = viewOfSolo(match);
      /*
        La manche tranchee, pour que l arene joue le CHOC des auras.

        L arene l attendait depuis que le choc existe (`useArena`, `round`) et
        personne ne la lui donnait : les deux personnages dansaient, un verdict
        tombait, et les faisceaux ne partaient jamais. L arene ne rejoue pas
        deux fois la meme manche — elle compare son numero.
      */
      arena.round.current = seen.lastRound;
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
      // Un rapport laisse derriere soi rejouerait son choc au match suivant.
      arena.round.current = null;
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

  const clock = useCallback(() => performance.now() - startedAt.current, []);

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
    setNow(0);
  }, []);

  const preview = useCallback((next: ChoicePreview | null) => {
    previewRef.current = next;
  }, []);

  const match = matchRef.current;
  return { view: viewOfSolo(match), actions, nowMs, clock, restart, preview };
}
