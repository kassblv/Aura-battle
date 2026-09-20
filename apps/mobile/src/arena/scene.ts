import { Color, Fog, type PerspectiveCamera, Scene } from 'three';
import { ArenaCameraRig, createArenaCamera, type CameraFraming } from './camera.js';
import { measureViewport, type Viewport } from './coords.js';
import { createLighting } from './lighting.js';
import { ARENA_COLORS } from './palette.js';
import { createStage, type Stage } from './stage.js';
import { createCrowd, type Crowd } from './crowd.js';
import { createFighterRig, type FighterRig, type RigPlacement } from './rig.js';
import { createToonGradientMap } from './toonGradient.js';
import { createFlash, type Flash } from './flash.js';
import type { QualityProfile } from '../platform/quality.js';
import { createParticleFields, projectionScale, type ParticleFields } from './particles.js';
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
  /** Voile blanc plein ecran, entre 0 et 1. Absent vaut zero. */
  readonly flash?: number;
  readonly reducedMotion: boolean;
  /**
   * Vrai hors match : un seul personnage a l ecran, camera au doigt.
   *
   * L arene s en sert pour retirer les silhouettes du premier plan — elles
   * cadrent un duel, elles masqueraient un vetement qu on vient essayer.
   */
  readonly showcase?: boolean;
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
  /**
   * Le puits a particules de toute l arene.
   *
   * Exposé plutot qu alimente ici : ce qui emet — le realisateur du choc,
   * demain les auras — vit au-dessus de la scene, qui n a pas a connaitre le
   * match. Deux appels de dessin quoi qu il arrive.
   */
  readonly particles: ParticleFields;
  /** Metriques du calque 2D, mises a jour par `setSize`. */
  readonly viewport: Viewport;
  /**
   * `pixelRatio` sert a la taille des particules : un point exprime en metres
   * doit valoir le meme nombre de **pixels physiques** sur tous les ecrans.
   */
  setSize(width: number, height: number, pixelRatio?: number): void;
  /**
   * Applique un palier de qualite (`platform/quality.ts`).
   *
   * La scene ne choisit pas : elle pose. Rien n est alloue ni libere ici, ce
   * sont trois compteurs qu on abaisse — un palier change en plein match, a la
   * frontiere d une manche, et l appareil concerne a deja du mal.
   *
   * Le quatrieme levier, le rapport de pixels, appartient au rendu, qui vit
   * au-dessus de la scene et detient le canvas.
   */
  applyQuality(profile: QualityProfile): void;
  update(frame: ArenaFrame): void;
  dispose(): void;
}

export function createArenaScene(options: ArenaSceneOptions): ArenaScene {
  const background = new Color(ARENA_COLORS.background);
  const scene = new Scene();
  scene.background = background;
  // Le brouillard commence juste derriere les combattants : il efface les
  // gradins du fond et garde l attention au centre.
  scene.fog = new Fog(background.getHex(), 6.5, 17);

  const gradientMap = createToonGradientMap();
  const lighting = createLighting();
  const stage = createStage(
    {
      gradientMap,
      floorTexture: options.textures.floor,
      hazeTexture: options.textures.haze,
    },
    options.rng,
  );
  const crowd = createCrowd({ gradientMap, glow: options.textures.glow }, options.rng);

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

  const particles = createParticleFields();

  scene.add(
    lighting.group,
    stage.group,
    crowd.group,
    fighters.a.root,
    fighters.b.root,
    particles.group,
  );

  const camera = createArenaCamera(1);
  camera.name = 'camera';
  const rig = new ArenaCameraRig(camera);

  /**
   * La camera entre dans le graphe, pour son voile.
   *
   * Three.js ne rend que ce qui est atteignable depuis la scene : un enfant de
   * camera restee dehors verrait sa matrice mise a jour et ne serait jamais
   * dessine.
   */
  const flash: Flash = createFlash();
  camera.add(flash.mesh);
  scene.add(camera);

  let viewport = measureViewport(1, 1);
  let disposed = false;

  return {
    scene,
    camera,
    stage,
    crowd,
    fighters,
    particles,

    get viewport(): Viewport {
      return viewport;
    },

    applyQuality(profile): void {
      crowd.setVisibleSeats(profile.crowdSeats);
      particles.setLimits(profile.additiveParticles, profile.darkParticles);
      fighters.a.setHandsVisible(profile.hands);
      fighters.b.setHandsVisible(profile.hands);
    },

    setSize(width: number, height: number, pixelRatio = 1): void {
      viewport = measureViewport(width, height);
      // Une fenetre repliee (rotation, clavier) donnerait un rapport NaN.
      camera.aspect = height > 0 ? width / height : 1;
      camera.updateProjectionMatrix();
      flash.setAspect(camera.aspect);
      particles.setProjectionScale(projectionScale(height, pixelRatio, camera.fov));
    },

    update(frame: ArenaFrame): void {
      lighting.update(frame.hype);
      stage.update(frame.elapsed, frame.hype);
      crowd.update(frame.elapsed, frame.hype, frame.showcase === true);
      // Le voile est coupe en amont par `impulseFor` quand l utilisateur
      // demande moins d animation : ici on se contente de le poser.
      flash.set(frame.flash ?? 0);

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
      particles.dispose();
      flash.dispose();
      camera.clear();
      fighters.a.dispose();
      fighters.b.dispose();
      lighting.dispose();
      gradientMap.dispose();
      options.textures.floor.dispose();
      options.textures.glow.dispose();
      options.textures.haze.dispose();
      scene.clear();
    },
  };
}
