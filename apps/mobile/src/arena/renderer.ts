import { WebGLRenderer } from 'three';
import { ARENA_COLORS } from './palette.js';

/**
 * Contexte WebGL de l arene.
 *
 * Seul module qui touche la carte graphique : il n est donc pas couvert par les
 * tests, qui tournent sans navigateur. Tout ce qui pouvait etre calcule sans
 * WebGL vit ailleurs (`scene`, `camera`, `stage`).
 */

/**
 * Plafond du rapport de pixels.
 *
 * Au-dela, on paie quatre fois le cout de remplissage pour un gain invisible a
 * bout de bras. C est le premier levier du budget de 60 i/s.
 */
export const MAX_PIXEL_RATIO = 1.75;

export interface ArenaRenderer {
  readonly renderer: WebGLRenderer;
  setSize(width: number, height: number, devicePixelRatio: number): void;
  dispose(): void;
}

/**
 * Cree le rendu, ou `null` si l appareil n a pas de WebGL exploitable.
 *
 * Le prototype bascule alors sur un message dans le calque 2D plutot que sur un
 * ecran noir : l appelant doit prevoir ce cas.
 */
export function createArenaRenderer(canvas: HTMLCanvasElement): ArenaRenderer | null {
  let renderer: WebGLRenderer;
  try {
    renderer = new WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
  } catch {
    return null;
  }
  renderer.setClearColor(ARENA_COLORS.background, 1);

  return {
    renderer,

    setSize(width: number, height: number, devicePixelRatio: number): void {
      if (width <= 0 || height <= 0) {
        return;
      }
      renderer.setPixelRatio(Math.min(MAX_PIXEL_RATIO, devicePixelRatio));
      // `false` : on ne laisse pas Three.js ecrire la taille CSS du canvas,
      // c est la mise en page qui la fixe.
      renderer.setSize(width, height, false);
    },

    dispose(): void {
      renderer.dispose();
    },
  };
}
