/**
 * Index des animations par mouvement (docs/01-game-design.md §2).
 *
 * Le gameplay ne connait qu'un **mouvement** : style + palier. L'animation
 * jouee n'en est qu'un skin — deux animations du meme mouvement sont
 * strictement equivalentes au score. Cet index dit lesquelles existent, et
 * laquelle est offerte a tous.
 *
 * C'est la source de verite : l'outil de portage l'utilise pour nommer les
 * fichiers, et un test verifie qu'aucun fichier n'y manque ni ne s'y ajoute.
 */

export type Style = 'calme' | 'hype' | 'provoc';
export type Tier = 0 | 1 | 2 | 3 | 4;

export interface Move {
  readonly style: Style;
  readonly tier: Tier;
}

/**
 * Pour chaque mouvement, les animations disponibles.
 * **La premiere de chaque liste est offerte a tous** ; les suivantes sont des
 * cosmetiques. Aucune ne modifie le score (regle d'or n°3).
 */
export const MOVE_ANIMATIONS: Readonly<Record<Style, Readonly<Record<Tier, readonly string[]>>>> =
  Object.freeze({
    calme: {
      0: ['crossed'],
      1: ['pocket'],
      2: ['lookaway'],
      3: ['meditate', 'moonwalk'],
      4: ['levitate', 'backflip'],
    },
    hype: {
      0: ['dab'],
      1: ['sixseven'],
      2: ['fist', 'floss'],
      3: ['griddy', 'spin'],
      4: ['boat'],
    },
    provoc: {
      0: ['shush'],
      1: ['point', 'tpose'],
      2: ['mewing', 'shrug'],
      3: ['lfront'],
      4: ['back'],
    },
  });

/** Animations jouees par la mise en scene, jamais choisies par un joueur. */
export const SYSTEM_ANIMATIONS: readonly string[] = [
  'charge',
  'land',
  'stagger',
  'victory',
  'defeat',
];

export const STYLES: readonly Style[] = ['calme', 'hype', 'provoc'];
export const TIERS: readonly Tier[] = [0, 1, 2, 3, 4];

/** Identifiant complet d'une animation de mouvement. */
export function animationId(move: Move, slug: string): string {
  return `anim.${move.style}.t${move.tier}.${slug}`;
}

/** Identifiant complet d'une animation systeme. */
export function systemAnimationId(slug: string): string {
  return `anim.system.none.${slug}`;
}

/** Les slugs disponibles pour un mouvement, dans l'ordre du catalogue. */
export function animationsFor(move: Move): readonly string[] {
  return MOVE_ANIMATIONS[move.style][move.tier];
}

/**
 * L'animation jouee par defaut pour un mouvement.
 *
 * Elle sert de repli quand le joueur n'a rien equipe, ou quand le cosmetique
 * demande n'est pas possede : le serveur ne refuse pas le choix pour autant,
 * il joue l'animation offerte (docs/03, validation de `choice:lock`).
 */
export function defaultAnimationFor(move: Move): string {
  const slug = animationsFor(move)[0];
  if (slug === undefined) {
    throw new Error(`Aucune animation pour le mouvement ${move.style} t${move.tier}`);
  }
  return animationId(move, slug);
}

/** Tous les identifiants d'animation du catalogue, mouvements et systeme. */
export function allAnimationIds(): readonly string[] {
  const moves = STYLES.flatMap((style) =>
    TIERS.flatMap((tier) =>
      animationsFor({ style, tier }).map((slug) => animationId({ style, tier }, slug)),
    ),
  );
  return [...moves, ...SYSTEM_ANIMATIONS.map(systemAnimationId)];
}
