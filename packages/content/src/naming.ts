import type { Style, Tier } from './catalogue.js';
import { defaultEffectForLevel, type AmplifierLevel } from './cosmetics.js';

/**
 * Les noms que le joueur lit.
 *
 * Un palier s'appelait « 3 » et un amplificateur « ×1,40 ». Ce sont les
 * chiffres du moteur, pas un vocabulaire de jeu : personne ne raconte a un ami
 * qu'il a gagne en jouant « palier 3 amplificateur 1,40 ». Les chiffres
 * restent — ils disent le cout et la puissance, et les cacher rendrait le choix
 * opaque — mais ils accompagnent desormais un nom.
 *
 * Le nom ne remplace donc rien et ne calcule rien : aucune valeur d'equilibrage
 * ne vit ici. Changer « Orage » en « Tempete » ne peut pas deregler une manche.
 */

export interface LocalizedName {
  readonly fr: string;
}

/**
 * Noms des paliers, par intensite croissante.
 *
 * Ils doivent valoir pour les trois styles : un palier 4 calme est une
 * levitation, un palier 4 hype une danse du bateau, et le meme mot les couvre
 * tous les deux. D'ou un vocabulaire d'intensite d'aura plutot que de geste.
 */
const TIER_NAMES: Readonly<Record<Tier, LocalizedName>> = {
  0: { fr: 'Souffle' },
  1: { fr: 'Éclat' },
  2: { fr: 'Vague' },
  3: { fr: 'Orage' },
  4: { fr: 'Apogée' },
};

const STYLE_NAMES: Readonly<Record<Style, LocalizedName>> = {
  calme: { fr: 'Calme' },
  hype: { fr: 'Hype' },
  provoc: { fr: 'Provoc' },
  acrobatie: { fr: 'Acrobatie' },
  prouesse: { fr: 'Prouesse' },
};

const STYLE_ICONS: Readonly<Record<Style, string>> = {
  calme: '🧊',
  hype: '🔥',
  provoc: '😏',
  acrobatie: '🤸',
  prouesse: '💪',
};

/** L icone d une famille : une seule source, lue par tous les ecrans. */
export function styleIcon(style: Style): string {
  return STYLE_ICONS[style];
}

export function tierName(tier: Tier): LocalizedName {
  return TIER_NAMES[tier];
}

export function styleName(style: Style): LocalizedName {
  return STYLE_NAMES[style];
}

/**
 * Le nom d'un amplificateur est celui de son effet offert.
 *
 * Inventer un second vocabulaire a cote de « Lueur, Étincelles, Éclairs,
 * Vortex, Galaxie » donnerait deux noms a la meme chose — et c'est cet effet-la
 * que le joueur voit tourner autour de son aura pendant la manche.
 */
export function amplifierName(level: AmplifierLevel): LocalizedName {
  return defaultEffectForLevel(level).name;
}
