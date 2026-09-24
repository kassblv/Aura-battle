import {
  AURA_COLORS,
  AURA_EFFECTS,
  discountedPrice,
  featuredForDay,
  HAIRSTYLES,
  OUTFITS,
  styleIcon,
} from '@aura/content';
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

export type ShopSectionId = 'featured' | 'dance' | 'outfit' | 'hair' | 'aura' | 'effect';

export interface ShopItem {
  readonly id: string;
  readonly name: string;
  /** Ce qu on montre : un symbole pour une emote, une couleur sinon. */
  readonly glyph?: string;
  readonly swatch?: string;
  readonly swatchSecondary?: string;
  readonly price: number;
  /**
   * Le prix plein, quand l article est en vitrine.
   *
   * Present uniquement la : partout ailleurs le prix affiche EST le prix
   * plein, et porter les deux inviterait a afficher une fausse remise.
   */
  readonly fullPrice?: number;
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

/**
 * Le symbole d'un effet d'aura payant.
 *
 * Une pastille de couleur ne dirait rien : un effet est un MOUVEMENT de
 * particules, pas une teinte. Le symbole en donne l'idee, et le personnage a
 * gauche donnera le reste — c'est tout l'interet d'une boutique ou l'on essaie.
 */
const EFFECT_GLYPHS: Readonly<Record<string, string>> = {
  'fx.flames': '🔥',
  'fx.shock': '💥',
  'fx.dark': '🖤',
};

/** Le style d'une danse se lit d'un coup d'oeil ; son nom, non. */

/**
 * L etalage.
 *
 * Seuls les objets payants y figurent : ce qui est offert appartient deja a
 * tout le monde, et l afficher a zero franc donnerait au joueur l impression
 * d avoir a l acheter.
 */
export function shopSections(day: number): readonly ShopSection[] {
  const featured = new Set(featuredForDay(day));

  /*
    La vitrine reprend des articles qui figurent DEJA plus bas, au prix plein.

    Elle s ajoute, elle ne remplace pas : avec une trentaine d articles, cacher
    le reste derriere une rotation ferait attendre des semaines quelqu un qui
    veut une danse precise. Ici il peut toujours l acheter — et il a une raison
    de repasser demain pour voir si elle est remisee.
  */
  const all = allSections();
  const featuredItems = all
    .flatMap((section) => section.items)
    .filter((entry) => featured.has(entry.id))
    .map((entry) => ({ ...entry, price: discountedPrice(entry.price), fullPrice: entry.price }));

  return featuredItems.length === 0
    ? all
    : [{ id: 'featured' as const, title: 'Vitrine du jour · −30 %', items: featuredItems }, ...all];
}

function allSections(): readonly ShopSection[] {
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
          glyph: styleIcon(card.style),
          price: card.price,
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
    /**
     * Les effets d'aura.
     *
     * Huit existaient au catalogue, le serveur savait les vendre, le protocole
     * les transportait et l'arene savait les dessiner — et aucun ecran ne les
     * montrait. Trois cosmetiques inatteignables, les plus spectaculaires du
     * jeu.
     *
     * Le titre dit ce qu'on achete, parce que ca ne se devine pas : un skin
     * habille UN amplificateur (docs/01 §3). Acheter les Flammes ne repeint
     * pas toute la partie — ca change ce que l'adversaire voit quand on joue
     * ce palier-la, au moment de la revelation.
     */
    {
      id: 'effect',
      title: 'Effets d’aura · un amplificateur chacun',
      items: AURA_EFFECTS.filter((effect) => effect.price > 0).map((effect) => ({
        id: effect.id,
        // « Flammes · A1 » : le niveau fait partie de ce qu'on achete, et le
        // taire laisserait croire a un effet permanent.
        name: `${effect.name.fr} · A${String(effect.level)}`,
        glyph: EFFECT_GLYPHS[effect.id] ?? '✨',
        price: effect.price,
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

/*
  Le catalogue du client sert a nommer, jamais a facturer.

  Construit a partir des sections SANS vitrine : le prix qui compte est celui
  que le serveur applique, et il le recalcule avec SON jour. Y ranger les prix
  remises ferait croire ici a un total que la-bas on refuserait.
*/
const catalogue = new Map<string, ShopItem>();
for (const section of allSections()) {
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
