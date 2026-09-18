import { Color, Fog, type PerspectiveCamera, Scene } from 'three';
import { ArenaCameraRig, createArenaCamera, type CameraFraming } from './camera.js';
import { measureViewport, type Viewport } from './coords.js';
import { createLighting } from './lighting.js';
import { ARENA_COLORS } from './palette.js';
import { createStage, type Stage } from './stage.js';
import { createCrowd, type Crowd } from './crowd.js';
import { createFighterRig, type FighterRig, type RigPlacement } from './rig.js';
import { createToonGradientMap } from './toonGradient.js';
import type { ArenaTextures } from './textures.js';

/**
 * Assemblage de l arene : fond, brouillard, eclairage, decor, camera.
 *
 * Volontairement sans `WebGLRenderer` : tout ce qui est ici se construit et se
 * verifie sans contexte graphique. Le rendu proprement dit est branche par
 * l appelant, qui detient le canvas.
 */

export interface ArenaSceneOptions {
  /** La scene prend possession de ces textures et les liberera. */
  readonly textures: ArenaTextures;
  /** Injecte pour que le ciel etoile soit reproductible dans les tests. */
  readonly rng: () => number;
}

/** Tout ce dont l arene a besoin pour avancer d une image. */
export interface ArenaFrame {
  readonly framing: CameraFraming;
  /** Temps ecoule depuis le demarrage, en secondes. */
  readonly elapsed: number;
  /** Duree de l image, en secondes, hors ralenti. */
  readonly delta: number;
  /** Ferveur du public, entre 0 et 1. */
  readonly hype: number;
  readonly shake: number;
  readonly reducedMotion: boolean;
}

/**
 * Les deux sieges, nommes comme le moteur les nomme (ADR 0006).
 *
 * Le cote de l arene ou chacun est dessine est une decision de rendu : le
 * client place toujours son propre siege a gauche, quel qu il soit.
 */
export interface Fighters {
  readonly a: FighterRig & { readonly placement: RigPlacement };
  readonly b: FighterRig & { readonly placement: RigPlacement };
}

export interface ArenaScene {
  readonly scene: Scene;
  readonly camera: PerspectiveCamera;
  readonly stage: Stage;
  readonly crowd: Crowd;
  readonly fighters: Fighters;
  /** Metriques du calque 2D, mises a jour par `setSize`. */
  readonly viewport: Viewport;
  setSize(width: number, height: number): void;
  update(frame: ArenaFrame): void;
  dispose(): void;
}

export function createArenaScene(options: ArenaSceneOptions): ArenaScene {
  const background = new Color(ARENA_COLORS.background);
  const scene = new Scene();
  scene.background = background;
  // Le brouillard commence juste derriere les combattants : il efface les
  // gradins du fond et garde l attention au centre.
  scene.fog = new Fog(background.getHex(), 7, 19);

  const gradientMap = createToonGradientMap();
  const lighting = createLighting();
  const stage = createStage({ gradientMap, gridTexture: options.textures.grid }, options.rng);
  const crowd = createCrowd({ gradientMap }, options.rng);

  /**
   * Un trois-quarts, pas un profil.
   *
   * De profil on ne voit pas le visage, et le visage porte l expression que le
   * contenu declare. De face, les poses — pensees en deux dimensions dans un
   * plan lateral — s ecrasent. Les deux combattants sont donc tournes de part
   * et d autre, legerement vers la camera.
   */
  const placements: Record<'a' | 'b', RigPlacement> = {
    a: { turn: -0.5, facing: 1 },
    b: { turn: Math.PI + 0.5, facing: -1 },
  };

  const fighters: Fighters = {
    a: Object.assign(createFighterRig({ gradientMap }, placements.a), { placement: placements.a }),
    b: Object.assign(createFighterRig({ gradientMap }, placements.b), { placement: placements.b }),
  };
  fighters.a.root.position.x = -1.45;
  fighters.b.root.position.x = 1.45;

  scene.add(lighting.group, stage.group, crowd.group, fighters.a.root, fighters.b.root);

  const camera = createArenaCamera(1);
  const rig = new ArenaCameraRig(camera);

  let viewport = measureViewport(1, 1);
  let disposed = false;

  return {
    scene,
    camera,
    stage,
    crowd,
    fighters,

    get viewport(): Viewport {
      return viewport;
    },

    setSize(width: number, height: number): void {
      viewport = measureViewport(width, height);
      // Une fenetre repliee (rotation, clavier) donnerait un rapport NaN.
      camera.aspect = height > 0 ? width / height : 1;
      camera.updateProjectionMatrix();
    },

    update(frame: ArenaFrame): void {
      stage.update(frame.elapsed, frame.hype);
      crowd.update(frame.elapsed, frame.hype);
      rig.update({
        framing: frame.framing,
        elapsed: frame.elapsed,
        delta: frame.delta,
        shake: frame.shake,
        reducedMotion: frame.reducedMotion,
      });
    },

    dispose(): void {
      if (disposed) {
        return;
      }
      disposed = true;
      stage.dispose();
      crowd.dispose();
      fighters.a.dispose();
      fighters.b.dispose();
      lighting.dispose();
      gradientMap.dispose();
      options.textures.grid.dispose();
      scene.clear();
    },
  };
}
