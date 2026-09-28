import { Mesh, MeshBasicMaterial, PlaneGeometry } from 'three';
import { CAMERA_FOV } from './camera.js';
import { clamp } from './math.js';

/**
 * Le voile blanc plein ecran (`flash` du prototype).
 *
 * Un quadrilatere accroche a la camera, pas un calque de l interface : le
 * voile appartient a la mise en scene de l arene, et le faire vivre dans le
 * DOM obligerait chaque ecran a le reimplementer.
 *
 * Il ne coute un appel de dessin **que** pendant le voile : au repos, le noeud
 * est `visible = false` et Three.js ne le traverse pas.
 */

/** Distance du voile devant la camera, en metres. Devant le plan proche. */
const FLASH_DISTANCE = 0.2;

/** Sous ce seuil, le voile n est plus visible : autant ne pas le dessiner. */
const FLASH_EPSILON = 0.01;

/**
 * Taille du quadrilatere qui remplit exactement le cadre.
 *
 * Le champ de vision de Three.js est **vertical** : c est la hauteur qui se
 * deduit du `fov`, et la largeur qui se deduit du rapport d image. Prendre le
 * `fov` pour horizontal donne un voile trop etroit en paysage — soit
 * exactement le format du jeu.
 */
export function flashQuadSize(
  distance: number,
  aspect: number,
  fovDegrees: number = CAMERA_FOV,
): readonly [number, number] {
  const height = 2 * distance * Math.tan((fovDegrees * Math.PI) / 360);
  // Un rapport nul ou negatif — fenetre repliee, rotation en cours — donnerait
  // une largeur nulle, donc un voile invisible au pire moment.
  return [height * Math.max(0.1, aspect), height];
}

export interface Flash {
  readonly mesh: Mesh;
  /** A rappeler a chaque redimensionnement. */
  setAspect(aspect: number): void;
  /** Opacite entre 0 et 1. */
  set(amount: number): void;
  dispose(): void;
}

export function createFlash(): Flash {
  const geometry = new PlaneGeometry(1, 1);
  const material = new MeshBasicMaterial({
    color: 0xffffff,
    transparent: true,
    opacity: 0,
    // Le voile passe devant tout, sans rien ecrire dans le tampon de
    // profondeur ni se laisser teinter par le brouillard de la salle.
    depthTest: false,
    depthWrite: false,
    fog: false,
  });
  const mesh = new Mesh(geometry, material);
  mesh.name = 'flash';
  mesh.position.z = -FLASH_DISTANCE;
  mesh.renderOrder = 1000;
  mesh.frustumCulled = false;
  mesh.visible = false;

  let disposed = false;

  return {
    mesh,

    setAspect(aspect): void {
      const [width, height] = flashQuadSize(FLASH_DISTANCE, aspect);
      mesh.scale.set(width, height, 1);
    },

    set(amount): void {
      const opacity = clamp(amount, 0, 1);
      material.opacity = opacity;
      mesh.visible = opacity > FLASH_EPSILON;
    },

    dispose(): void {
      if (disposed) return;
      disposed = true;
      geometry.dispose();
      material.dispose();
    },
  };
}
