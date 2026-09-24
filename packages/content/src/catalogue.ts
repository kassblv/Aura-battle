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

export type Style = 'calme' | 'hype' | 'provoc' | 'acrobatie' | 'prouesse';
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
      0: ['crossed', 'behind'],
      1: ['pocket', 'stride'],
      2: ['lookaway', 'crown'],
      3: ['meditate', 'moonwalk', 'slowkick'],
      4: ['levitate'],
    },
    hype: {
      0: ['dab'],
      1: ['sixseven', 'shoulders'],
      2: ['fist', 'floss', 'goal'],
      3: ['griddy'],
      4: ['boat'],
    },
    provoc: {
      0: ['shush', 'skyward'],
      1: ['point', 'tpose'],
      2: ['mewing', 'shrug', 'slowclap'],
      3: ['lfront', 'dust'],
      4: ['back', 'bow'],
    },
    /*
      La voltige : les quatre acrobaties qui vivaient chez Hype et Calme y ont
      ete deplacees, et chacune y est devenue la pose offerte de sa case.
    */
    acrobatie: {
      0: ['jumpclap'],
      1: ['roll'],
      2: ['wheel'],
      3: ['spin'],
      4: ['backflip'],
    },
    /* La force pure : pompes, gainage, equilibres. */
    prouesse: {
      0: ['flex'],
      1: ['pushups'],
      2: ['plank'],
      3: ['handstand'],
      4: ['humanflag'],
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

/**
 * L ordre du cercle des contres (docs/01 §2) : chaque famille bat la suivante
 * et celle a trois crans. Ne pas trier.
 */
export const STYLES: readonly Style[] = ['calme', 'hype', 'provoc', 'acrobatie', 'prouesse'];
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
 * Les identifiants complets disponibles pour un mouvement.
 *
 * `animationsFor` rend des slugs, `defaultAnimationFor` un identifiant complet :
 * comparer l'un a l'autre ne donne jamais d'egalite, et l'appelant se retrouve
 * a jouer l'animation offerte en croyant jouer le cosmetique equipe. Cette
 * fonction supprime l'asymetrie plutot que de demander a chacun de s'en
 * souvenir.
 */
export function animationIdsFor(move: Move): readonly string[] {
  return animationsFor(move).map((slug) => animationId(move, slug));
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

/** Index inverse : identifiant complet d une pose → son mouvement. */
const MOVE_BY_ANIMATION: ReadonlyMap<string, Move> = new Map(
  STYLES.flatMap((style) =>
    TIERS.flatMap((tier) =>
      animationsFor({ style, tier }).map(
        (slug) => [animationId({ style, tier }, slug), { style, tier }] as const,
      ),
    ),
  ),
);

/**
 * Le mouvement d une pose, ou `null` si ce n est pas une pose de mouvement.
 *
 * C est ce que le serveur lit au verrouillage : le client ne dit que la pose,
 * et famille et palier s en deduisent ici, nulle part ailleurs.
 */
export function moveOfAnimation(id: string): Move | null {
  return MOVE_BY_ANIMATION.get(id) ?? null;
}
