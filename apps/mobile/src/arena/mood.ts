import { clamp } from './math.js';
import { ARENA_MOOD } from './palette.js';

/**
 * L ambiance de l arene selon la ferveur du public.
 *
 * Le portage initial posait un eclairage fixe : une salle qui ne reagit a rien
 * est plate en valeurs, et rien ne distingue la recharge — ou il ne se passe
 * encore rien — du choc qui decide la manche. Ici la lumiere bascule avec
 * `hype` : froide et basse quand le duel s installe, chaude et haute quand la
 * salle s embrase.
 *
 * Tout est pur : `hype` entre, des couleurs sortent. `lighting.ts` et
 * `stage.ts` se contentent de les poser.
 */

/** Une couleur du decor, en composantes sRGB entre 0 et 1. */
export type Rgb = readonly [number, number, number];

export interface ArenaMood {
  readonly ambientSky: Rgb;
  readonly ambientGround: Rgb;
  readonly ambientIntensity: number;
  readonly keyColor: Rgb;
  readonly keyIntensity: number;
  /**
   * Le contre-jour, qui detoure les combattants sur le fond sombre.
   *
   * C est lui qui fait la profondeur : sans liseré lumineux au dos, un
   * personnage sombre devant une foule sombre n a plus de contour.
   */
  readonly backColor: Rgb;
  readonly backIntensity: number;
  readonly rimColor: Rgb;
  /** Brume au sol : elle se leve avec la salle. */
  readonly hazeColor: Rgb;
  readonly hazeOpacity: number;
  /** Les faisceaux de projecteur, qui se devoilent quand l air s epaissit. */
  readonly sweepOpacity: number;
}

const HEX_RE = /^#[0-9a-fA-F]{6}$/;

/**
 * Lit une couleur ecrite en hexadecimal, telle quelle.
 *
 * Pas de passage par l espace lineaire : ces valeurs sont des couleurs
 * d interface, et `Color.setRGB(..., SRGBColorSpace)` les reprend dans le meme
 * espace. Convertir ici sans reconvertir la-bas sortirait un or en brun.
 */
export function srgb(hex: string): Rgb {
  if (!HEX_RE.test(hex)) {
    throw new Error(`Couleur hexadecimal attendue sous la forme #rrggbb : ${hex}`);
  }
  const n = Number.parseInt(hex.slice(1), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

export function mixRgb(a: Rgb, b: Rgb, t: number): Rgb {
  const k = clamp(t, 0, 1);
  return [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k];
}

const CALM = {
  ambientSky: srgb(ARENA_MOOD.calm.ambientSky),
  ambientGround: srgb(ARENA_MOOD.calm.ambientGround),
  key: srgb(ARENA_MOOD.calm.key),
  back: srgb(ARENA_MOOD.calm.back),
  rim: srgb(ARENA_MOOD.calm.rim),
  haze: srgb(ARENA_MOOD.calm.haze),
} as const;

const BLAZE = {
  ambientSky: srgb(ARENA_MOOD.blaze.ambientSky),
  ambientGround: srgb(ARENA_MOOD.blaze.ambientGround),
  key: srgb(ARENA_MOOD.blaze.key),
  back: srgb(ARENA_MOOD.blaze.back),
  rim: srgb(ARENA_MOOD.blaze.rim),
  haze: srgb(ARENA_MOOD.blaze.haze),
} as const;

/**
 * La bascule n est pas lineaire.
 *
 * La ferveur passe l essentiel d un match entre 0,2 et 0,5 : une droite y
 * laisserait la salle tiede en permanence et ne garderait le spectacle que
 * pour la seule image du choc. La racine donne du relief des la recharge, et
 * garde de la marge pour la revelation.
 */
export function moodCurve(hype: number): number {
  return Math.sqrt(clamp(hype, 0, 1));
}

export function arenaMood(hype: number): ArenaMood {
  const t = moodCurve(hype);

  return {
    ambientSky: mixRgb(CALM.ambientSky, BLAZE.ambientSky, t),
    ambientGround: mixRgb(CALM.ambientGround, BLAZE.ambientGround, t),
    ambientIntensity: 0.5 + t * 0.32,
    keyColor: mixRgb(CALM.key, BLAZE.key, t),
    keyIntensity: 0.6 + t * 0.4,
    backColor: mixRgb(CALM.back, BLAZE.back, t),
    // Le contre-jour monte plus vite que la principale : c est le detourage
    // qui doit gagner quand la salle se remplit de monde et de lumiere.
    backIntensity: 0.75 + t * 0.95,
    rimColor: mixRgb(CALM.rim, BLAZE.rim, t),
    hazeColor: mixRgb(CALM.haze, BLAZE.haze, t),
    hazeOpacity: 0.18 + t * 0.26,
    /*
      Les faisceaux restent au seuil du visible.

      A 0,10 d opacite additive ils cessent d etre de l air eclaire et
      deviennent des voiles tendus en travers du cadre — juste derriere la tete
      des combattants, la ou il n y a rien a poser.
    */
    sweepOpacity: 0.028 + t * 0.032,
  };
}
