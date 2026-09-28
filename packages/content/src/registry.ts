import type { Animation } from './animation.js';
import { STYLES, TIERS, type Move, type Style, type Tier } from './catalogue.js';
import { priceForRarity, RARITY_ORDER } from './pricing.js';
import type { Rarity } from './cosmetics.js';

/**
 * Le registre du contenu, construit A L'EXECUTION (chantier n°11).
 *
 * Il remplace une liste ecrite en code (`MOVE_ANIMATIONS`) : ajouter une danse
 * ne doit demander aucun TypeScript (regle d'or n° 5). La case d'une danse se
 * lit dans son identifiant ; la pose offerte d'une case est son animation de
 * rarete `default`, et il y en a EXACTEMENT une par case — sans quoi le
 * registre refuse de se construire (regle d'or n° 3, ADR 0014 : chaque case a
 * sa pose offerte, et rien d'achetable ne la remplace).
 *
 * Pur : une liste d'animations deja validees en entree, aucune I/O. Le serveur
 * le construit a partir des fichiers embarques et de la base ; le client, des
 * fichiers embarques et de son cache.
 */

export type ParsedAnimationId =
  | { readonly kind: 'move'; readonly move: Move; readonly slug: string }
  | { readonly kind: 'system'; readonly slug: string };

const ID = /^anim\.([a-z]+)\.(?:t([0-4])|none)\.([a-z0-9]+(?:-[a-z0-9]+)*)$/;

/** La case (ou le role systeme) d'une animation, lue dans son identifiant ; `null` si mal forme. */
export function parseAnimationId(id: string): ParsedAnimationId | null {
  const match = ID.exec(id);
  if (match === null) return null;
  const [, family, tier, slug] = match;
  if (family === undefined || slug === undefined) return null;
  if (family === 'system') return tier === undefined ? { kind: 'system', slug } : null;
  if (tier === undefined || !(STYLES as readonly string[]).includes(family)) return null;
  return { kind: 'move', move: { style: family as Style, tier: Number(tier) as Tier }, slug };
}

export class ContentRegistryError extends Error {
  constructor(readonly issues: readonly string[]) {
    super(`registre de contenu invalide : ${issues.join(' ; ')}`);
    this.name = 'ContentRegistryError';
  }
}

const caseKey = (move: Move): string => `${move.style}.${move.tier}`;
const rarityOf = (animation: Animation): Rarity =>
  (RARITY_ORDER as readonly string[]).includes(animation.rarity ?? '')
    ? (animation.rarity as Rarity)
    : 'default';

export class ContentRegistry {
  private constructor(
    private readonly byId: ReadonlyMap<string, Animation>,
    private readonly moves: ReadonlyMap<string, Move>,
    private readonly cases: ReadonlyMap<string, readonly string[]>,
    private readonly bundledIds: ReadonlySet<string>,
  ) {}

  /** Le registre du contenu embarque. Leve `ContentRegistryError` si un invariant casse. */
  static build(animations: readonly Animation[]): ContentRegistry {
    return ContentRegistry.assemble(animations, new Set(animations.map((a) => a.id)));
  }

  /**
   * Une nouvelle version du registre, avec des danses publiees depuis le
   * panneau. Une danse publiee ne remplace JAMAIS la pose offerte (rarete
   * `default` refusee) et n'ecrase jamais une danse embarquee.
   */
  withPublished(published: readonly Animation[]): ContentRegistry {
    const issues = published
      .filter((animation) => rarityOf(animation) === 'default')
      .map((animation) => `${animation.id} : une danse publiee ne peut pas etre la pose offerte`);
    if (issues.length > 0) throw new ContentRegistryError(issues);
    return ContentRegistry.assemble([...this.byId.values(), ...published], this.bundledIds);
  }

  private static assemble(
    animations: readonly Animation[],
    bundledIds: ReadonlySet<string>,
  ): ContentRegistry {
    const issues: string[] = [];
    const byId = new Map<string, Animation>();
    const moves = new Map<string, Move>();
    const offered = new Map<string, string[]>();
    const others = new Map<string, string[]>();

    for (const animation of animations) {
      if (byId.has(animation.id)) {
        issues.push(`${animation.id} en double`);
        continue;
      }
      const parsed = parseAnimationId(animation.id);
      if (parsed === null) {
        issues.push(`${animation.id} : identifiant mal forme`);
        continue;
      }
      byId.set(animation.id, animation);
      if (parsed.kind === 'system') continue;
      moves.set(animation.id, parsed.move);
      const bucket = rarityOf(animation) === 'default' ? offered : others;
      const key = caseKey(parsed.move);
      bucket.set(key, [...(bucket.get(key) ?? []), animation.id]);
    }

    const cases = new Map<string, readonly string[]>();
    for (const style of STYLES) {
      for (const tier of TIERS) {
        const key = caseKey({ style, tier });
        const defaults = offered.get(key) ?? [];
        if (defaults.length !== 1) {
          issues.push(
            `${style} t${tier} : ${String(defaults.length)} pose(s) offerte(s), il en faut une`,
          );
          continue;
        }
        // La pose offerte d'abord, puis les autres par ordre alphabetique : un
        // ordre stable, independant de l'ordre des fichiers ou de la base.
        cases.set(key, [...defaults, ...(others.get(key) ?? []).sort()]);
      }
    }

    if (issues.length > 0) throw new ContentRegistryError(issues);
    return new ContentRegistry(byId, moves, cases, bundledIds);
  }

  animation(id: string): Animation | undefined {
    return this.byId.get(id);
  }

  /** Les poses d'une case, la pose offerte en tete. */
  animationIdsFor(move: Move): readonly string[] {
    return this.cases.get(caseKey(move)) ?? [];
  }

  /** La pose offerte d'une case : celle jouee quand rien n'est equipe ou possede. */
  defaultAnimationFor(move: Move): string {
    const id = this.animationIdsFor(move)[0];
    if (id === undefined) throw new Error(`aucune pose pour ${move.style} t${String(move.tier)}`);
    return id;
  }

  moveOfAnimation(id: string): Move | null {
    return this.moves.get(id) ?? null;
  }

  allAnimationIds(): readonly string[] {
    return [...this.byId.keys()];
  }

  /** Vrai pour une animation livree avec le jeu (non modifiable depuis le panneau). */
  isBundled(id: string): boolean {
    return this.bundledIds.has(id);
  }

  /**
   * Le prix de bareme, en pieces : 0 pour la pose offerte et les animations
   * systeme, le bareme de la rarete sinon. Le prix ENCAISSE reste celui du
   * serveur (`CosmeticItem`), que le panneau peut regler.
   */
  priceOf(id: string): number {
    const animation = this.byId.get(id);
    if (animation === undefined) return 0;
    const parsed = parseAnimationId(id);
    if (parsed?.kind !== 'move') return 0;
    const rarity = rarityOf(animation);
    return rarity === 'default' ? 0 : priceForRarity(rarity);
  }
}
