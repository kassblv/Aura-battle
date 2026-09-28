import type { Style, Tier } from '@aura/content';
import type { Move } from '@aura/rules';
import { nextVariant, type HandCard } from './hand.js';
import type { Wardrobe } from './wardrobe.js';

/**
 * Ce que fait un toucher sur une carte de la main, decide hors de React.
 *
 * - `deny` : trop chere — elle tremble, l'en-tete dit ce qui manque ;
 * - `flip` : deja choisie et riche de variantes — elle se retourne sur la
 *   suivante, qui devient la presélection de la case. Ce n'est PAS un nouveau
 *   choix : la jauge n'est ni rearmee ni relancee ;
 * - `pick` : elle devient le choix, et la jauge s'arme au premier.
 */
export type CardGesture =
  | { readonly kind: 'deny'; readonly tier: Tier }
  | { readonly kind: 'flip'; readonly poseId: string }
  | { readonly kind: 'pick'; readonly move: Move };

export interface ChoiceSelection {
  /** Famille choisie, ou `null` tant qu'aucune carte ne l'est. */
  readonly style: Style | null;
  readonly tier: Tier;
  /** Famille dont la main est ouverte. */
  readonly family: Style;
}

export function cardGesture(
  card: HandCard,
  selection: ChoiceSelection,
  wardrobe: Wardrobe,
): CardGesture {
  if (!card.affordable) return { kind: 'deny', tier: card.tier };
  const move = { style: selection.family, tier: card.tier };
  const alreadyChosen = selection.style === selection.family && selection.tier === card.tier;
  if (alreadyChosen && card.variants.owned > 1) {
    return { kind: 'flip', poseId: nextVariant(wardrobe, move) };
  }
  return { kind: 'pick', move };
}

/**
 * La famille a montrer.
 *
 * Tant qu'il choisit, le joueur regarde ou il veut. Au verrouillage, la main
 * revient sur la carte jouee : l'ecrasement se voit sur la bonne carte, et non
 * sur une main grisee d'une autre famille.
 */
export function familyToShow(input: {
  readonly locked: boolean;
  readonly style: Style | null;
  readonly family: Style;
}): Style {
  return input.locked && input.style !== null ? input.style : input.family;
}
