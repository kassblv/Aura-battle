import { CanvasTexture, SRGBColorSpace, type Texture } from 'three';
import { withAlpha } from './palette.js';

/**
 * Textures peintes au canvas, portees du prototype.
 *
 * Seul module de l arene qui a besoin du DOM : tout le reste se construit et se
 * teste sans navigateur. Les fonctions de rendu recoivent donc leurs textures
 * en parametre plutot que de les fabriquer elles-memes.
 */

export interface ArenaTextures {
  /** Grille lumineuse du dessus de la plateforme. */
  readonly grid: Texture;
}

function paintTexture(
  width: number,
  height: number,
  paint: (ctx: CanvasRenderingContext2D, width: number, height: number) => void,
): CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error("Le canvas 2D n'est pas disponible sur cet appareil.");
  }
  paint(ctx, width, height);
  const texture = new CanvasTexture(canvas);
  // Ces textures sont peintes avec des couleurs d interface, donc en sRGB.
  texture.colorSpace = SRGBColorSpace;
  return texture;
}

/** Quadrillage violet et cercle central dore, dans l esprit d un tatami. */
export function createGridTexture(): CanvasTexture {
  return paintTexture(512, 512, (ctx, w, h) => {
    ctx.clearRect(0, 0, w, h);
    ctx.strokeStyle = withAlpha('#b36bff', 0.35);
    ctx.lineWidth = 2;
    for (let i = 0; i <= w; i += 40) {
      ctx.beginPath();
      ctx.moveTo(i, 0);
      ctx.lineTo(i, h);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(0, i);
      ctx.lineTo(w, i);
      ctx.stroke();
    }
    ctx.strokeStyle = withAlpha('#ffcf3f', 0.45);
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.arc(w / 2, h / 2, w * 0.22, 0, Math.PI * 2);
    ctx.stroke();
  });
}

export function createArenaTextures(): ArenaTextures {
  return { grid: createGridTexture() };
}
