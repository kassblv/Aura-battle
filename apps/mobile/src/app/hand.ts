import { STYLES, styleIcon, type Style, type Tier, TIERS } from '@aura/content';
import { BALANCE, type Move } from '@aura/rules';
import { poseIcon } from '../content/animations.js';
import { danceOptions, type Wardrobe } from './wardrobe.js';

/**
 * La main de cartes de l'ecran de choix (chantier n°2), en donnees pures.
 *
 * Toute la logique de la main vit ici, hors de React : quelle pose chaque
 * carte montre, ce qu'elle coute, si elle brille, combien de variantes elle
 * cache. Le composant ne fait qu'afficher ce que ce module decide.
 */

/** Une carte de la main : une case (famille × palier) et la pose qui la joue. */
export interface HandCard {
  readonly tier: Tier;
  /** La pose montree : la presélection possedee de la case, sinon l'offerte. */
  readonly poseId: string;
  readonly icon: string;
  readonly name: string;
  readonly power: number;
  readonly cost: number;
  /** Palier et amplificateur tiennent dans l'energie jouable. */
  readonly affordable: boolean;
  /** C'est la case brillante du joueur pour cette manche (×1,2). */
  readonly shiny: boolean;
  readonly variants: {
    /** Rang de la pose montree parmi les possedees. */
    readonly index: number;
    /** Poses jouables dans cette case (l'offerte comprise). */
    readonly owned: number;
    /** Poses de la case encore a debloquer. */
    readonly toUnlock: number;
  };
}

export interface HandInput {
  readonly family: Style;
  readonly wardrobe: Wardrobe;
  /** Energie jouable cette manche : le plafond du panneau de choix. */
  readonly budget: number;
  /** Cout de l'amplificateur choisi, qui se paie avec le palier. */
  readonly amplifierCost: number;
  readonly shiny: Move | null;
}

export function handFor(input: HandInput): readonly HandCard[] {
  return TIERS.map((tier): HandCard => {
    const move = { style: input.family, tier };
    const options = danceOptions(input.wardrobe, move);
    const index = Math.max(
      0,
      options.choices.findIndex((card) => card.animationId === options.current),
    );
    const shown = options.choices[index];
    const cost = BALANCE.tierCost[tier];
    return {
      tier,
      poseId: options.current,
      icon: poseIcon(options.current),
      name: shown?.name ?? '',
      power: BALANCE.tierPower[tier],
      cost,
      affordable: cost + input.amplifierCost <= input.budget,
      shiny:
        input.shiny !== null && input.shiny.style === input.family && input.shiny.tier === tier,
      variants: { index, owned: options.choices.length, toUnlock: options.forSale },
    };
  });
}

/** La pose qui vient apres celle montree dans cette case, en bouclant. */
export function nextVariant(wardrobe: Wardrobe, move: Move): string {
  return danceOptions(wardrobe, move).next;
}

/** Un onglet de famille : son icone, ce qu'elle bat, et si la brillante y attend. */
export interface FamilyTab {
  readonly family: Style;
  readonly icon: string;
  readonly beats: readonly Style[];
  readonly shiny: boolean;
}

export function tabsFor(shiny: Move | null): readonly FamilyTab[] {
  return STYLES.map((family) => ({
    family,
    icon: styleIcon(family),
    beats: BALANCE.styleBeats[family],
    shiny: shiny?.style === family,
  }));
}
