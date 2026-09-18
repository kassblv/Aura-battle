/**
 * Systeme de design d'Aura Battle.
 *
 * L'identite vient du prototype, que `CLAUDE.md` designe comme reference de
 * rendu : Bungee pour l'affichage, Rubik pour le texte, une palette d'aura
 * violette en clair et en sombre. Les jetons sont de la **donnee**, pas du CSS,
 * pour la meme raison que les animations : ce qui est une valeur se teste.
 *
 * Trois couleurs s'ecartent du prototype, et c'est deliberé — voir `goldInk`.
 */

export interface Palette {
  /** Fond de l'application. */
  readonly bg: string;
  /** Cartes et panneaux poses sur le fond. */
  readonly surface: string;
  /** Pastilles et champs, poses sur une carte. */
  readonly chip: string;
  /**
   * Contours et separateurs.
   *
   * Seuil bas assume : un separateur est decoratif, il structure sans porter
   * d'information. Ce qui doit atteindre 3:1 est l'anneau de focus, et c'est
   * `accent` qui le dessine.
   */
  readonly line: string;
  /** Texte principal. */
  readonly ink: string;
  /** Texte secondaire, legendes. */
  readonly muted: string;
  /** Couleur d'action : boutons, jauges, anneaux de focus. */
  readonly accent: string;
  /** Texte pose sur `accent`. */
  readonly accentInk: string;

  /**
   * Couleurs d'etat, version **decorative** : halos, barres, particules, gros
   * chiffres animes. Elles portent l'identite, pas la lisibilite.
   */
  readonly gold: string;
  readonly good: string;
  readonly bad: string;

  /**
   * Couleurs d'etat, version **texte**.
   *
   * Le prototype posait l'or a 2,44:1 sur le fond clair — sous le seuil « grand
   * texte » lui-meme, alors que c'est la couleur des recompenses et des points,
   * donc precisement les chiffres que le joueur veut lire. Recopier la palette
   * telle quelle aurait reconduit ce defaut sur l'ecran le plus gratifiant du
   * jeu.
   *
   * En sombre les couleurs d'origine passent largement : `*Ink` y vaut la
   * couleur decorative. C'est seulement en clair qu'elles s'assombrissent.
   */
  readonly goldInk: string;
  readonly goodInk: string;
  readonly badInk: string;
}

export const PALETTE_KEYS = [
  'bg',
  'surface',
  'chip',
  'line',
  'ink',
  'muted',
  'accent',
  'accentInk',
  'gold',
  'good',
  'bad',
  'goldInk',
  'goodInk',
  'badInk',
] as const satisfies readonly (keyof Palette)[];

export const LIGHT: Palette = Object.freeze({
  bg: '#efe8ff',
  surface: '#ffffff',
  chip: '#f6f1ff',
  line: '#d9cdf5',
  ink: '#1e1240',
  muted: '#6a5d8f',
  accent: '#7a3cff',
  accentInk: '#ffffff',
  gold: '#c98c00',
  good: '#138a52',
  bad: '#d2344b',
  goldInk: '#8a5d00',
  goodInk: '#0f7043',
  badInk: '#c01d35',
});

export const DARK: Palette = Object.freeze({
  bg: '#150c2e',
  surface: '#221545',
  chip: '#2a1b55',
  // Eclairci depuis le prototype (#3a2a6b) : il tombait a 1,37:1 sur une
  // carte, soit un separateur qu'on ne distingue plus dehors.
  line: '#453380',
  ink: '#f3ecff',
  muted: '#a99cd0',
  accent: '#b36bff',
  accentInk: '#150c2e',
  gold: '#ffcf3f',
  good: '#5be3a0',
  bad: '#ff6b81',
  goldInk: '#ffcf3f',
  goodInk: '#5be3a0',
  badInk: '#ff6b81',
});

/**
 * Typographie.
 *
 * Bungee ne sert qu'a l'affichage — titres, scores, verdicts. C'est une
 * capitale lourde : un paragraphe compose dedans devient illisible, et le
 * prototype ne s'en sert jamais autrement.
 */
export const TYPOGRAPHY = Object.freeze({
  display: '"Bungee", Impact, "Arial Black", sans-serif',
  body: '"Rubik", system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
  /** Echelle en pixels, du plus discret au verdict de fin de match. */
  size: Object.freeze({
    caption: 12,
    small: 13,
    body: 16,
    title: 20,
    score: 24,
    verdict: 42,
  }),
});

/** Echelle d'espacement, en pixels. Tout multiple hors echelle est un accident. */
export const SPACING = Object.freeze({
  xs: 4,
  sm: 8,
  md: 12,
  lg: 18,
  xl: 24,
  xxl: 36,
});

export const RADIUS = Object.freeze({
  chip: 8,
  card: 14,
  pill: 999,
});

/**
 * Mouvement.
 *
 * Les durees sont la moitie visible du game feel. `tap` est le retour immediat
 * d'un geste : au-dela d'une centaine de millisecondes, l'oeil cesse de le lire
 * comme la consequence du geste et le ressent comme de la latence. `reveal` est
 * l'anticipation avant le choc des auras — la seule duree qu'on a interet a
 * rendre longue, parce qu'elle fait monter l'attente.
 */
export const MOTION = Object.freeze({
  duration: Object.freeze({
    tap: 90,
    chip: 160,
    panel: 240,
    reveal: 520,
  }),
  easing: Object.freeze({
    /** Sortie franche : la reponse part vite puis se pose. */
    out: 'cubic-bezier(0.16, 1, 0.3, 1)',
    /** Entree et sortie adoucies, pour un panneau. */
    inOut: 'cubic-bezier(0.65, 0, 0.35, 1)',
    /** Depassement leger : ce qui donne du poids a un chiffre qui apparait. */
    overshoot: 'cubic-bezier(0.34, 1.56, 0.64, 1)',
  }),
});

/** `goldInk` devient `--gold-ink` : la convention CSS, pas celle de TypeScript. */
const toVariableName = (key: string): string =>
  `--${key.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)}`;

/** Declarations CSS d'une palette, a poser dans un bloc `:root`. */
export function cssVariables(palette: Palette): string {
  return PALETTE_KEYS.map((key) => `${toVariableName(key)}: ${palette[key]};`).join('\n  ');
}
