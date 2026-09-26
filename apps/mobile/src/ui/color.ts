/**
 * Arithmetique des couleurs, telle que WCAG 2.1 la definit.
 *
 * Elle vit ici plutot que dans une feuille de style parce qu'un rapport de
 * contraste doit pouvoir etre **affirme par un test**. Une palette relue a
 * l'oeil passe toujours : c'est en mode clair, au soleil, sur un telephone
 * qu'elle echoue, et personne ne developpe dans ces conditions.
 */

export type Rgb = readonly [number, number, number];

const HEX = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;

/** Composantes d'une couleur hexadecimale, forme courte acceptee. */
export function parseHex(value: string): Rgb {
  if (!HEX.test(value)) {
    throw new TypeError(`couleur hexadecimale attendue, recu : ${value}`);
  }
  const digits = value.slice(1);
  const full =
    digits.length === 3
      ? digits
          .split('')
          .map((digit) => digit + digit)
          .join('')
      : digits;
  return [
    Number.parseInt(full.slice(0, 2), 16),
    Number.parseInt(full.slice(2, 4), 16),
    Number.parseInt(full.slice(4, 6), 16),
  ];
}

/**
 * Linearise une composante sRGB.
 *
 * L'ecran applique une correction gamma : un gris a mi-chemin en valeur n'est
 * pas a mi-chemin en lumiere. Sans cette etape, un contraste calcule sur les
 * valeurs brutes se trompe d'un facteur qui atteint deux dans les tons moyens —
 * exactement la zone ou les erreurs de palette se produisent.
 */
const linearize = (channel: number): number => {
  const c = channel / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
};

/** Luminance relative : 0 pour le noir, 1 pour le blanc. */
export function relativeLuminance(color: string): number {
  const [r, g, b] = parseHex(color);
  return 0.2126 * linearize(r) + 0.7152 * linearize(g) + 0.0722 * linearize(b);
}

/**
 * Rapport de contraste entre deux couleurs, de 1 (identiques) a 21.
 *
 * Seuils utiles : 4,5 pour du texte courant, 3 pour du grand texte et pour les
 * composants d'interface (contours, anneaux de focus, jauges), 7 pour le
 * niveau AAA.
 */
export function contrastRatio(a: string, b: string): number {
  const [high, low] = [relativeLuminance(a), relativeLuminance(b)].sort((x, y) => y - x) as [
    number,
    number,
  ];
  return (high + 0.05) / (low + 0.05);
}

/**
 * Melange deux couleurs, comme `color-mix(in srgb, a <ratio>%, b)`.
 *
 * `in srgb` interpole sur les coordonnees **gamma-encodees**, pas sur la
 * lumiere : une moyenne par canal sur 0-255 donne donc exactement ce que le
 * navigateur affiche. C'est ce qui permet de tester le contraste d'une bande
 * peinte en `color-mix` sans la rendre.
 */
export function mix(a: string, b: string, ratio: number): string {
  if (!(ratio >= 0 && ratio <= 1)) {
    throw new RangeError(`proportion attendue dans [0, 1], recu : ${String(ratio)}`);
  }
  const [ar, ag, ab] = parseHex(a);
  const [br, bg, bb] = parseHex(b);
  const channel = (from: number, to: number): string =>
    Math.round(from * ratio + to * (1 - ratio))
      .toString(16)
      .padStart(2, '0');
  return `#${channel(ar, br)}${channel(ag, bg)}${channel(ab, bb)}`;
}
