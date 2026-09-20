import { useEffect, useMemo, useRef, type RefObject } from 'react';
import type { Animation } from '@aura/content';
import { animationBounds, type AnimationBounds } from '../animation/bounds.js';
import { createPoseSmoother, breatheInto } from '../animation/smooth.js';
import { samplePose } from '../animation/sample.js';
import { ANIMATIONS } from '../content/animations.js';
import type { Presentation } from '../match/presentation.js';
import { watchReducedMotion } from '../platform/reducedMotion.js';
import { previewFraming, wideFraming } from './camera.js';
import { createOrbitControl } from './orbit.js';
import { createArenaRenderer } from './renderer.js';
import { createArenaScene } from './scene.js';
import { createArenaTextures } from './textures.js';

/**
 * Fait vivre l arene dans React.
 *
 * Seul module du client qui touche a la fois React et la carte graphique : il
 * n est donc pas couvert par les tests, comme `renderer.ts`. Tout ce qui se
 * decide vit ailleurs — `presentation.ts` dit quoi montrer, `smooth.ts` comment
 * l animer — et se teste sans navigateur.
 *
 * La mise en scene arrive par une **reference mutable**, jamais par une
 * dependance d effet : reconstruire la scene a chaque image de match couterait
 * une seconde de chargement par phase.
 */

/**
 * Encombrement des animations, mesure une fois par identifiant.
 *
 * Trente-deux echantillons de pose par animation : le refaire a chaque image
 * pour choisir une distance de camera serait payer soixante fois par seconde
 * une mesure qui ne change jamais.
 */
const boundsCache = new Map<string, AnimationBounds>();

function boundsOf(animation: Animation): AnimationBounds {
  let bounds = boundsCache.get(animation.id);
  if (bounds === undefined) {
    bounds = animationBounds(animation);
    boundsCache.set(animation.id, bounds);
  }
  return bounds;
}

export interface ArenaControls {
  /** Ce que l arene doit montrer, relu a chaque image. */
  readonly presentation: RefObject<Presentation | null>;
  /**
   * Vrai hors match : un seul personnage, cadrage de vitrine, orbite au doigt.
   *
   * Pendant un match la camera est une mise en scene, elle appartient au jeu :
   * le glissement n y fait rien.
   */
  readonly showcase: RefObject<boolean>;
  /**
   * Ramene le personnage de face dans la vitrine.
   *
   * Appele tout seul quand un duel commence ; expose pour qu un bouton
   * « recentrer » puisse le faire aussi.
   */
  resetOrbit(): void;
}

export function useArena(canvasRef: RefObject<HTMLCanvasElement | null>): ArenaControls {
  const presentation = useRef<Presentation | null>(null);
  const showcase = useRef(true);
  // Cree une seule fois : l angle doit survivre aux rendus de React, pas
  // repartir de zero a chaque fois que l accueil se redessine.
  const orbit = useRef(createOrbitControl());

  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas === null) return;

    const renderer = createArenaRenderer(canvas);
    // Sans WebGL, le calque 2D reste seul a l ecran : c est degrade, pas casse.
    if (renderer === null) return;

    const textures = createArenaTextures();
    const arena = createArenaScene({ textures, rng: Math.random });
    const smoothers = { a: createPoseSmoother(), b: createPoseSmoother() };

    const motion = watchReducedMotion();
    const control = orbit.current;

    const resize = (): void => {
      const { clientWidth, clientHeight } = canvas;
      arena.setSize(clientWidth, clientHeight);
      renderer.setSize(clientWidth, clientHeight, window.devicePixelRatio);
      control.setViewport(clientWidth, clientHeight);
    };
    const observer = new ResizeObserver(resize);
    observer.observe(canvas);
    resize();

    /**
     * Glissement sur l arene : le joueur retourne son personnage.
     *
     * L ecoute est posee sur le **canvas**, pas sur la fenetre : les boutons de
     * l accueil sont au-dessus dans le document, un appui sur l un d eux ne
     * descend donc jamais jusqu ici. La capture de pointeur fait le reste — un
     * glissement qui sort du canvas continue d etre livre au canvas.
     *
     * `touch-action` est pose en JavaScript plutot qu en CSS : la feuille de
     * style appartient a l interface, et cette regle n existe que parce que
     * cette ecoute existe. Sans elle, le navigateur fait defiler la page au
     * lieu de laisser tourner le personnage.
     */
    const previousTouchAction = canvas.style.touchAction;
    canvas.style.touchAction = 'none';

    const onPointerDown = (event: PointerEvent): void => {
      if (!showcase.current) return;
      control.start({ id: event.pointerId, x: event.clientX, y: event.clientY });
      canvas.setPointerCapture(event.pointerId);
    };
    const onPointerMove = (event: PointerEvent): void => {
      control.move({ id: event.pointerId, x: event.clientX, y: event.clientY });
    };
    const onPointerUp = (event: PointerEvent): void => {
      control.end(event.pointerId);
    };
    /**
     * Le glissement s interrompt sans `pointerup` : appel entrant, geste
     * systeme, application mise en arriere-plan. Sans cette annulation, le
     * personnage tournerait pour toujours.
     *
     * Le garde n est pas une precaution : `lostpointercapture` suit **chaque**
     * `pointerup`, capture relachee implicitement par le navigateur. Annuler
     * sans condition tuerait donc l inertie de tous les lachers, et le geste
     * s arreterait net a chaque fois.
     */
    const onPointerLost = (): void => {
      if (control.dragging) control.cancel();
    };

    canvas.addEventListener('pointerdown', onPointerDown);
    canvas.addEventListener('pointermove', onPointerMove);
    canvas.addEventListener('pointerup', onPointerUp);
    canvas.addEventListener('pointercancel', onPointerLost);
    canvas.addEventListener('lostpointercapture', onPointerLost);

    let frame = 0;
    let previous = performance.now();
    let wasShowcase = showcase.current;

    const tick = (now: number): void => {
      frame = requestAnimationFrame(tick);
      // Un onglet revenu au premier plan livre plusieurs secondes d un coup :
      // les rattraper ferait traverser l arene aux personnages.
      const delta = Math.min(0.25, (now - previous) / 1000);
      previous = now;
      const elapsed = now / 1000;

      const scene = presentation.current;
      const solo = showcase.current;

      /**
       * Un duel qui commence remet le personnage de face.
       *
       * Garder l angle **pendant** l inspection est le contrat (celui qui a
       * tourne pour voir le dos veut rester la) ; le garder d un duel a l autre
       * ne l est pas — on revient a l accueil et le personnage est de dos, sans
       * que personne l ait demande.
       */
      if (!solo && wasShowcase) control.reset();
      wasShowcase = solo;

      let showcaseAnimation: Animation | undefined;

      for (const seat of ['a', 'b'] as const) {
        const fighter = arena.fighters[seat];
        const shown = scene?.fighters[seat];
        if (shown === undefined) continue;
        fighter.dress(shown.look);
        const animation = ANIMATIONS.get(shown.animationId);
        if (animation === undefined) continue;
        if (seat === 'a') showcaseAnimation = animation;
        // Le decalage de phase evite que les deux respirent a l unisson.
        const offset = seat === 'a' ? 0 : 1.7;
        const target = breatheInto(samplePose(animation, elapsed, offset), elapsed, offset);
        fighter.pose(smoothers[seat].step(target, delta), animation, elapsed, delta);
      }

      arena.fighters.b.root.visible = !solo;
      control.update(solo ? delta : 0);

      /**
       * Hors match, le joueur revient au centre.
       *
       * En duel il tient le siege de gauche ; seul a l ecran, rien ne justifie
       * qu il reste decale — le vide a droite se lirait comme un adversaire
       * manquant. Le retour est progressif : une teleportation entre deux
       * ecrans casserait la continuite de la vitrine.
       */
      const restX = solo ? 0 : -1.45;
      const fighter = arena.fighters.a.root;
      fighter.position.x += (restX - fighter.position.x) * Math.min(1, delta * 4);

      /**
       * Le cadrage de la vitrine suit le meme joue.
       *
       * Rien de plus a appeler depuis l accueil : `presentation` porte deja
       * l identifiant de l animation, et sa mesure dit quelle distance il
       * faut. Une danse qui saute plus haut se cadre toute seule.
       */
      const framing =
        solo && showcaseAnimation !== undefined
          ? previewFraming({
              worldX: fighter.position.x,
              bounds: boundsOf(showcaseAnimation),
              shot: showcaseAnimation.framing?.shot,
              orbit: control.yaw,
              tilt: control.tilt,
            })
          : wideFraming();

      arena.update({
        elapsed,
        delta,
        framing,
        hype: scene?.hype ?? 0.2,
        shake: 0,
        reducedMotion: motion.reduced,
      });
      renderer.renderer.render(arena.scene, arena.camera);
    };

    frame = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      canvas.removeEventListener('pointerdown', onPointerDown);
      canvas.removeEventListener('pointermove', onPointerMove);
      canvas.removeEventListener('pointerup', onPointerUp);
      canvas.removeEventListener('pointercancel', onPointerLost);
      canvas.removeEventListener('lostpointercapture', onPointerLost);
      canvas.style.touchAction = previousTouchAction;
      motion.dispose();
      arena.dispose();
      renderer.dispose();
    };
  }, [canvasRef]);

  /**
   * Une identite stable, pas un objet neuf a chaque rendu.
   *
   * Les refs, elles, ne changent jamais ; c est l enveloppe qui trahissait.
   * Un appelant qui met `arena` dans ses dependances relancait son effet a
   * chaque rendu — anodin pour une boucle d animation, fatal pour celui qui
   * tient la socket du duel.
   */
  return useMemo(
    () => ({
      presentation,
      showcase,
      resetOrbit(): void {
        orbit.current.reset();
      },
    }),
    [],
  );
}
