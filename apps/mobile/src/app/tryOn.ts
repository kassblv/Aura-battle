import { AURA_COLORS, AURA_EFFECTS } from '@aura/content';
import { memeGallery } from './memes.js';
import type { Look } from './wardrobe.js';

/**
 * Essayer un article, sans l'acheter ni le porter.
 *
 * Une boutique qui montre des vignettes vend mal : un mème est un MOUVEMENT,
 * une tenue se juge sur un personnage, et une couleur d'aura ne veut rien dire
 * dans un carré de 40 pixels. Ici, toucher un article l'enfile sur le
 * personnage qui se tient deja au centre de l'ecran.
 *
 * La fonction est pure et ne modifie jamais l'apparence d'origine : c'est la
 * seule chose qui distingue « essayer » d'« equiper ». Reposer l'article rend
 * le joueur a lui-meme, sans rien a annuler.
 */

export interface TryOn {
  readonly look: Look;
  readonly animationId: string;
}

/**
 * Les couleurs d'aura se portent par leur VALEUR, pas par leur identifiant.
 *
 * Le rig attend un hexadecimal ; lui passer `color.violet` repeindrait le
 * personnage en noir. Le catalogue est la seule source de la correspondance.
 */
const HEX_BY_COLOR = new Map(AURA_COLORS.map((color) => [color.id, color.hex]));

/**
 * Les effets d'aura : ils s'essaient autour du personnage.
 *
 * Oublies ici, ils etaient les seuls articles de la boutique qu'on touchait
 * sans rien voir changer — et ce sont les plus chers.
 */
const EFFECT_IDS = new Set(AURA_EFFECTS.map((effect) => effect.id));

/** Les danses, pour reconnaitre un identifiant d'animation vendable. */
const DANCE_IDS = new Set(memeGallery().map((card) => card.animationId));

export function tryOn(look: Look, animationId: string, itemId: string | null): TryOn {
  if (itemId === null) return { look, animationId };

  if (DANCE_IDS.has(itemId)) return { look, animationId: itemId };

  const hex = HEX_BY_COLOR.get(itemId);
  if (hex !== undefined) return { look: { ...look, aura: hex }, animationId };

  if (EFFECT_IDS.has(itemId)) return { look: { ...look, auraEffect: itemId }, animationId };

  if (itemId.startsWith('outfit.')) return { look: { ...look, outfit: itemId }, animationId };
  if (itemId.startsWith('hair.')) return { look: { ...look, hair: itemId }, animationId };

  // Un identifiant inconnu ne casse rien : on montre ce qu'on portait deja.
  return { look, animationId };
}
