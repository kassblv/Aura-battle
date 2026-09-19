import { useEffect, useRef, type RefObject } from 'react';
import { createPoseSmoother, breatheInto } from '../animation/smooth.js';
import { samplePose } from '../animation/sample.js';
import { ANIMATIONS } from '../content/animations.js';
import type { Presentation } from '../match/presentation.js';
import { soloFraming, wideFraming } from './camera.js';
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

export interface ArenaControls {
  /** Ce que l arene doit montrer, relu a chaque image. */
  readonly presentation: RefObject<Presentation | null>;
  /** Vrai hors match : un seul personnage, camera rapprochee. */
  readonly showcase: RefObject<boolean>;
}

export function useArena(canvasRef: RefObject<HTMLCanvasElement | null>): ArenaControls {
  const presentation = useRef<Presentation | null>(null);
  const showcase = useRef(true);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas === null) return;

    const renderer = createArenaRenderer(canvas);
    // Sans WebGL, le calque 2D reste seul a l ecran : c est degrade, pas casse.
    if (renderer === null) return;

    const textures = createArenaTextures();
    const arena = createArenaScene({ textures, rng: Math.random });
    const smoothers = { a: createPoseSmoother(), b: createPoseSmoother() };

    const resize = (): void => {
      const { clientWidth, clientHeight } = canvas;
      arena.setSize(clientWidth, clientHeight);
      renderer.setSize(clientWidth, clientHeight, window.devicePixelRatio);
    };
    const observer = new ResizeObserver(resize);
    observer.observe(canvas);
    resize();

    let frame = 0;
    let previous = performance.now();

    const tick = (now: number): void => {
      frame = requestAnimationFrame(tick);
      // Un onglet revenu au premier plan livre plusieurs secondes d un coup :
      // les rattraper ferait traverser l arene aux personnages.
      const delta = Math.min(0.25, (now - previous) / 1000);
      previous = now;
      const elapsed = now / 1000;

      const scene = presentation.current;
      const solo = showcase.current;

      for (const seat of ['a', 'b'] as const) {
        const fighter = arena.fighters[seat];
        const shown = scene?.fighters[seat];
        if (shown === undefined) continue;
        fighter.dress(shown.look);
        const animation = ANIMATIONS.get(shown.animationId);
        if (animation === undefined) continue;
        // Le decalage de phase evite que les deux respirent a l unisson.
        const offset = seat === 'a' ? 0 : 1.7;
        const target = breatheInto(samplePose(animation, elapsed, offset), elapsed, offset);
        fighter.pose(smoothers[seat].step(target, delta), animation, elapsed, delta);
      }

      arena.fighters.b.root.visible = !solo;

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

      arena.update({
        elapsed,
        delta,
        framing: solo ? soloFraming(fighter.position.x) : wideFraming(),
        hype: scene?.hype ?? 0.2,
        shake: 0,
        reducedMotion: false,
      });
      renderer.renderer.render(arena.scene, arena.camera);
    };

    frame = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      arena.dispose();
      renderer.dispose();
    };
  }, [canvasRef]);

  return { presentation, showcase };
}
