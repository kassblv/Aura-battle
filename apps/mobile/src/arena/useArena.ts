import { useEffect, useMemo, useRef, type RefObject } from 'react';
import type { Seat } from '@aura/rules';
import { createPoseSmoother, breatheInto } from '../animation/smooth.js';
import { samplePose } from '../animation/sample.js';
import { ANIMATIONS } from '../content/animations.js';
import type { Presentation } from '../match/presentation.js';
import { watchReducedMotion } from '../platform/reducedMotion.js';
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

/**
 * Aura demandee pour un siege.
 *
 * `color` vaut `null` tant que l appelant ne l impose pas : l arene reprend
 * alors la couleur d aura de la tenue affichee, pour que la vitrine suive le
 * vestiaire sans que personne ait a les recopier l une dans l autre.
 */
export interface AuraRequest {
  readonly effectId: string;
  readonly color: string | null;
  readonly intensity: number;
}

/** Au repos : l effet offert, discret, a la couleur de la tenue. */
export const RESTING_AURA: AuraRequest = Object.freeze({
  effectId: 'fx.glow',
  color: null,
  intensity: 0.35,
});

export interface ArenaControls {
  /** Ce que l arene doit montrer, relu a chaque image. */
  readonly presentation: RefObject<Presentation | null>;
  /** Vrai hors match : un seul personnage, camera rapprochee. */
  readonly showcase: RefObject<boolean>;
  /**
   * Change l aura d un siege. Seuls les champs fournis sont remplaces.
   *
   * Prise en compte a l image suivante, et sans effet de bord : un effet
   * inconnu retombe sur la Lueur au lieu de lever.
   */
  setAura(seat: Seat, request: Partial<AuraRequest>): void;
}

export function useArena(canvasRef: RefObject<HTMLCanvasElement | null>): ArenaControls {
  const presentation = useRef<Presentation | null>(null);
  const showcase = useRef(true);
  const auras = useRef<Record<Seat, AuraRequest>>({ a: RESTING_AURA, b: RESTING_AURA });

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

    const resize = (): void => {
      const { clientWidth, clientHeight } = canvas;
      renderer.setSize(clientWidth, clientHeight, window.devicePixelRatio);
      // La taille d un point depend du rapport de pixels reellement retenu par
      // le rendu, pas de celui que l appareil annonce.
      arena.setSize(clientWidth, clientHeight, renderer.renderer.getPixelRatio());
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

        const request = auras.current[seat];
        arena.setAura(seat, {
          effectId: request.effectId,
          color: request.color ?? shown.look.aura,
          intensity: request.intensity,
        });
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
        reducedMotion: motion.reduced,
      });
      renderer.renderer.render(arena.scene, arena.camera);
    };

    frame = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
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
      setAura(seat: Seat, request: Partial<AuraRequest>): void {
        auras.current = { ...auras.current, [seat]: { ...auras.current[seat], ...request } };
      },
    }),
    [],
  );
}
