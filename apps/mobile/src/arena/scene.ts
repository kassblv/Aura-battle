import { Color, Fog, type PerspectiveCamera, Scene } from 'three';
import { type AuraEmitter, type AuraGlow, type AuraLook, createAuraEmitter, createAuraGlow } from './aura.js';
import { ArenaCameraRig, CAMERA_FOV, createArenaCamera, type CameraFraming } from './camera.js';
import { measureViewport, type Viewport } from './coords.js';
import { createLighting } from './lighting.js';
import { ARENA_COLORS } from './palette.js';
import { createStage, type Stage } from './stage.js';
import { createCrowd, type Crowd } from './crowd.js';
import { createParticleFields, type ParticleFields, projectionScale } from './particles.js';
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
  /** Les deux auras, par siege. Exposees pour la vitrine et les tests. */
  readonly auras: Readonly<Record<'a' | 'b', AuraEmitter>>;
  readonly particles: ParticleFields;
  /** Metriques du calque 2D, mises a jour par `setSize`. */
  readonly viewport: Viewport;
  /**
   * Change l aura d un siege.
   *
   * Un effet inconnu retombe sur la Lueur sans lever : un cosmetique absent du
   * client ne doit jamais couter sa manche au joueur.
   */
  setAura(seat: 'a' | 'b', look: AuraLook): void;
  setSize(width: number, height: number, pixelRatio?: number): void;
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

  /**
   * Les auras, et le puits ou elles se dessinent.
   *
   * Un seul puits pour toute l arene : les particules des deux combattants
   * partent au GPU en deux appels de dessin, pas en plusieurs centaines.
   */
  const particles = createParticleFields();
  const auras: Record<'a' | 'b', AuraEmitter> = {
    a: createAuraEmitter(),
    b: createAuraEmitter(),
  };
  const glows: Record<'a' | 'b', AuraGlow> = {
    a: createAuraGlow({ texture: options.textures.glow }),
    b: createAuraGlow({ texture: options.textures.glow }),
  };

  scene.add(
    lighting.group,
    stage.group,
    crowd.group,
    fighters.a.root,
    fighters.b.root,
    glows.a.group,
    glows.b.group,
    particles.group,
  );

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
    auras,
    particles,

    get viewport(): Viewport {
      return viewport;
    },

    setAura(seat, look): void {
      auras[seat].set(look);
    },

    setSize(width: number, height: number, pixelRatio = 1): void {
      viewport = measureViewport(width, height);
      // Une fenetre repliee (rotation, clavier) donnerait un rapport NaN.
      camera.aspect = height > 0 ? width / height : 1;
      camera.updateProjectionMatrix();
      // Une particule est un point : sa taille se compte en pixels, et depend
      // donc de la hauteur rendue autant que du champ de vision.
      particles.setProjectionScale(projectionScale(height, pixelRatio, CAMERA_FOV));
    },

    update(frame: ArenaFrame): void {
      stage.update(frame.elapsed, frame.hype);
      crowd.update(frame.elapsed, frame.hype);

      particles.begin();
      for (const seat of ['a', 'b'] as const) {
        const emitter = auras[seat];
        const glow = glows[seat];
        emitter.setReducedMotion(frame.reducedMotion);
        // Un combattant cache ne doit rien emettre : sinon l accueil affiche
        // l aura d un adversaire absent, flottant dans le vide.
        if (!fighters[seat].root.visible) {
          emitter.clear();
          glow.update(emitter, { x: 0, y: 0, z: 0 });
          continue;
        }
        emitter.update(frame.delta);
        // `root.position` est aux pieds du combattant : x pose par l appelant,
        // y leve par le rig quand la pose decolle.
        const origin = fighters[seat].root.position;
        emitter.draw(particles, origin, frame.elapsed);
        glow.update(emitter, origin);
      }
      particles.commit();

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
      glows.a.dispose();
      glows.b.dispose();
      particles.dispose();
      lighting.dispose();
      gradientMap.dispose();
      options.textures.grid.dispose();
      options.textures.glow.dispose();
      scene.clear();
    },
  };
}
