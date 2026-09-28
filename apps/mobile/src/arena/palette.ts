import { Color } from 'three';

/**
 * Couleurs du decor, relevees sur `prototype/aura-battle.html`.
 *
 * Elles decrivent l arene, pas les combattants : la couleur d aura d un joueur
 * est un cosmetique qui arrive par le contenu, jamais d ici.
 */
export const ARENA_COLORS = {
  /** Fond et brouillard : la salle disparait dans le violet nuit. */
  background: '#0d0620',
  /**
   * Le bitume autour du cercle.
   *
   * Plus sombre que la plateforme, et nettement plus sombre que le portage
   * initial : c est l ecart de valeur entre le sol, le cercle et les
   * combattants qui fait tenir la lecture. A valeurs egales, tout se confond.
   */
  ground: '#0f0725',
  platform: '#251355',
  rim: '#b36bff',
  /** Les gradins alternent deux violets pour marquer les marches. */
  stands: ['#180d33', '#1d103d'],
  /** Bandeaux lumineux au nez de chaque marche, alternes eux aussi. */
  strips: ['#4fe3ff', '#ff4fa3'],
  /** Les trois projecteurs qui balaient la salle. */
  sweeps: ['#b36bff', '#4fe3ff', '#ff4fa3'],
} as const;

/**
 * Les deux extremes de l ambiance, entre lesquels `mood.ts` interpole.
 *
 * `calm` est la salle avant que rien n arrive ; `blaze` est l instant du choc.
 * Tout ce qui se joue entre les deux est une interpolation — aucune couleur
 * intermediaire ne s ecrit ailleurs qu ici.
 */
export const ARENA_MOOD = {
  calm: {
    ambientSky: '#8a74d8',
    ambientGround: '#150b2a',
    key: '#c9d4ff',
    back: '#7a4fd6',
    rim: '#9a5cff',
    haze: '#3a2170',
  },
  blaze: {
    ambientSky: '#d6aaff',
    ambientGround: '#2a1040',
    key: '#ffe7c4',
    back: '#ff5fb4',
    rim: '#ffd489',
    haze: '#8a3fb6',
  },
} as const;

/**
 * Couleurs partagees, construites une seule fois.
 *
 * La boucle de rendu convertit des teintes a chaque image (particules, foule) :
 * sans ce cache, on allouerait des milliers de `Color` par seconde. Les
 * instances rendues sont figees pour qu un appelant distrait ne puisse pas
 * repeindre la couleur de tout le monde.
 */
const cache = new Map<string, Color>();

export function colorOf(hex: string): Color {
  let color = cache.get(hex);
  if (!color) {
    color = Object.freeze(new Color(hex));
    cache.set(hex, color);
  }
  return color;
}

const HEX_RE = /^#[0-9a-fA-F]{6}$/;

/**
 * Traduit une couleur du decor en `rgba()` pour le calque 2D.
 *
 * Le canvas 2D ne comprend pas les couleurs de Three.js, et on veut la teinte
 * telle qu ecrite (sRGB), sans passer par la gestion de couleur du moteur.
 */
export function withAlpha(hex: string, alpha: number): string {
  if (!HEX_RE.test(hex)) {
    throw new Error(`Couleur hexadecimal attendue sous la forme #rrggbb : ${hex}`);
  }
  const n = Number.parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${alpha})`;
}
