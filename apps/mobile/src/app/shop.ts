import { AURA_COLORS, EMOTES, HAIRSTYLES, OUTFITS } from '@aura/content';
import { memeGallery } from './memes.js';
import type { Wallet } from './profile.js';

/**
 * La boutique.
 *
 * Elle ne vend que de l apparence — c est la regle d or n°3, et c est ici
 * qu elle se verifie, parce que c est ici que l argent change de main. Les
 * champs sont recopies un a un plutot que repandus : aucune valeur de jeu ne
 * peut ainsi remonter jusqu a l etalage le jour ou le catalogue gagne un champ.
 */

export type ShopSectionId = 'dance' | 'emote' | 'outfit' | 'hair' | 'aura';

export interface ShopItem {
  readonly id: string;
  readonly name: string;
  /** Ce qu on montre : un symbole pour une emote, une couleur sinon. */
  readonly glyph?: string;
  readonly swatch?: string;
  readonly swatchSecondary?: string;
  readonly price: number;
}

export interface ShopSection {
  readonly id: ShopSectionId;
  readonly title: string;
  readonly items: readonly ShopItem[];
}

export interface ShopState {
  readonly wallet: Wallet;
  readonly owned: ReadonlySet<string>;
}

const HAIR_SWATCH = '#1b1426';

/** Le style d'une danse se lit d'un coup d'oeil ; son nom, non. */
const STYLE_GLYPHS = { calme: '🧊', hype: '🔥', provoc: '😏' } as const;

/**
 * L etalage.
 *
 * Seuls les objets payants y figurent : ce qui est offert appartient deja a
 * tout le monde, et l afficher a zero franc donnerait au joueur l impression
 * d avoir a l acheter.
 */
export function shopSections(): readonly ShopSection[] {
  return [
    /**
     * Les danses d'abord.
     *
     * Une aura battle est un clash ou deux personnes rejouent des memes : la
     * danse est ce que le joueur vient chercher, pas une ligne de plus dans un
     * etalage. Elle ne change rien au score — deux animations d'un meme
     * mouvement sont strictement equivalentes (`docs/01` §2) — donc la vendre
     * ne heurte pas la regle d'or n°3.
     */
    {
      id: 'dance',
      title: 'Danses',
      items: memeGallery()
        .filter((card) => !card.free)
        .map((card) => ({
          id: card.animationId,
          name: card.name,
          glyph: STYLE_GLYPHS[card.style],
          price: card.price,
        })),
    },
    {
      id: 'emote',
      title: 'Émotes',
      items: EMOTES.filter((emote) => emote.price > 0).map((emote) => ({
        id: emote.id,
        name: emote.name.fr,
        glyph: emote.glyph,
        price: emote.price,
      })),
    },
    {
      id: 'outfit',
      title: 'Tenues',
      items: OUTFITS.filter((outfit) => outfit.price > 0).map((outfit) => ({
        id: outfit.id,
        name: outfit.name.fr,
        swatch: outfit.jacket,
        swatchSecondary: outfit.pants,
        price: outfit.price,
      })),
    },
    {
      id: 'hair',
      title: 'Coiffures',
      items: HAIRSTYLES.filter((hair) => hair.price > 0).map((hair) => ({
        id: hair.id,
        name: hair.name.fr,
        swatch: HAIR_SWATCH,
        price: hair.price,
      })),
    },
    {
      id: 'aura',
      title: 'Couleurs d’aura',
      items: AURA_COLORS.filter((color) => color.price > 0).map((color) => ({
        id: color.id,
        name: color.name.fr,
        swatch: color.hex,
        price: color.price,
      })),
    },
  ];
}

const catalogue = new Map<string, ShopItem>();
for (const section of shopSections()) {
  for (const item of section.items) catalogue.set(item.id, item);
}

/**
 * Achete un objet.
 *
 * Trois refus, et chacun protege le joueur : pas assez de monnaie, objet deja
 * possede — un double appui sur un bouton de boutique est la chose la plus
 * courante du monde, et il debiterait deux fois — et identifiant inconnu.
 *
 * Les objets offerts ne s achetent pas non plus : le debit serait nul, mais
 * l objet entrerait dans la liste des possessions et brouillerait la
 * distinction entre ce qui est offert et ce qui est achete.
 */
export function buy(state: ShopState, id: string): ShopState {
  const item = catalogue.get(id);
  if (item === undefined) return state;
  if (state.owned.has(id)) return state;
  if (state.wallet.soft < item.price) return state;

  const owned = new Set(state.owned);
  owned.add(id);
  return { wallet: { ...state.wallet, soft: state.wallet.soft - item.price }, owned };
}
