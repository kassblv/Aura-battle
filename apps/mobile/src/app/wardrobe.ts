import {
  type AmplifierLevel,
  AURA_COLORS,
  AURA_EFFECTS,
  danceKey,
  HAIRSTYLES,
  isExclusive,
  type Move,
  OUTFITS,
  SKIN_TONES,
} from '@aura/content';
import { memeGallery, type MemeCard } from './memes.js';

/**
 * Le vestiaire : ce que le joueur porte, et ce qu il a le droit de porter.
 *
 * Le catalogue vient de `@aura/content`, jamais d une copie locale. C est la
 * meme donnee que le serveur valide et que la boutique vend : une seconde liste
 * ici finirait par diverger, et la divergence porterait sur ce qu un joueur
 * possede.
 */

export type LookSlot = 'outfit' | 'hair' | 'skin' | 'aura';

export interface Look {
  readonly outfit: string;
  readonly hair: string;
  /** Teinte de peau, en hexadecimal : elle n a pas d identifiant, elle est sa valeur. */
  readonly skin: string;
  readonly aura: string;
  /**
   * Danse equipee par mouvement, indexee par `<style>.t<palier>`.
   *
   * Une danse s equipe POUR UN MOUVEMENT : le Moonwalk est un calme palier 3,
   * il ne peut pas remplacer un dab. Un emplacement global obligerait a
   * rejouer la meme danse quel que soit le mouvement joue — ou a l ignorer,
   * ce qui reviendrait a ne rien vendre.
   *
   * Absent = l animation offerte du mouvement. On ne stocke donc que les
   * choix, jamais les defauts.
   */
  readonly dances: Readonly<Record<string, string>>;
  /**
   * L effet d aura equipe, ou absent pour la Lueur offerte.
   *
   * `AURA_STYLES` existait depuis le portage des particules et n avait aucun
   * porteur : tout le monde jouait `fx.glow` code en dur. C est le loadout qui
   * le transporte maintenant.
   */
  readonly auraEffect?: string;
  /**
   * La danse signature : jouee a la victoire, d une manche comme du match, et
   * vue par l adversaire.
   *
   * Un emplacement a part, pas une entree de `dances` : on la rejoue quand on
   * gagne, quel que soit le coup qui a gagne. Absente : la pose de victoire du
   * jeu.
   */
  readonly signature?: string;
}

/**
 * La cle d un mouvement dans `Look.dances`.
 *
 * Delegue a `@aura/content` : le serveur lit la meme table pour annoncer la
 * danse equipee a la revelation, et deux conventions qui divergent ne
 * produiraient aucune erreur — seulement une danse que l adversaire ne voit
 * jamais.
 */
export function moveKey(move: Move): string {
  return danceKey(move);
}

export interface Wardrobe {
  readonly look: Look;
  /** Identifiants possedes. Ce qui est gratuit n a pas besoin d y figurer. */
  readonly owned: ReadonlySet<string>;
}

/** Un objet du catalogue, reduit a ce que l interface affiche. */
export interface WardrobeItem {
  readonly id: string;
  readonly name: string;
  /** Pastille de couleur, et sa seconde teinte pour une tenue. */
  readonly swatch: string;
  readonly swatchSecondary?: string;
  readonly price: number;
  /** Exclusif d'une saison (« Saison 1 ») : se gagne sur le passe, ne se vend pas. */
  readonly exclusive?: string;
}

export interface WardrobeSection {
  readonly id: LookSlot;
  readonly title: string;
  readonly items: readonly WardrobeItem[];
}

const HAIR_SWATCH = '#1b1426';

/**
 * Catalogue affichable, dans l ordre ou l on s habille.
 *
 * Les champs sont recopies un a un plutot que repandus : c est ce qui garantit
 * qu aucune valeur de jeu ne puisse arriver jusqu a l interface par accident
 * le jour ou le catalogue gagne un champ.
 */
export function wardrobeSections(): readonly WardrobeSection[] {
  return [
    {
      id: 'outfit',
      title: 'Tenue',
      items: OUTFITS.map((outfit) => ({
        id: outfit.id,
        name: outfit.name.fr,
        swatch: outfit.jacket,
        swatchSecondary: outfit.pants,
        price: outfit.price,
        ...(outfit.exclusive === undefined ? {} : { exclusive: outfit.exclusive }),
      })),
    },
    {
      id: 'hair',
      title: 'Coiffure',
      items: HAIRSTYLES.map((hair) => ({
        id: hair.id,
        name: hair.name.fr,
        swatch: HAIR_SWATCH,
        price: hair.price,
      })),
    },
    {
      id: 'skin',
      title: 'Teint',
      // Une apparence de base ne se vend pas : les teintes sont offertes.
      items: SKIN_TONES.map((tone, index) => ({
        id: tone,
        name: `Teint ${String(index + 1)}`,
        swatch: tone,
        price: 0,
      })),
    },
    {
      id: 'aura',
      title: 'Couleur d’aura',
      items: AURA_COLORS.map((color) => ({
        id: color.id,
        name: color.name.fr,
        swatch: color.hex,
        price: color.price,
        ...(color.exclusive === undefined ? {} : { exclusive: color.exclusive }),
      })),
    },
  ];
}

const itemIndex = new Map<string, WardrobeItem>();
for (const section of wardrobeSections()) {
  for (const item of section.items) itemIndex.set(item.id, item);
}

export function priceOf(id: string): number {
  return itemIndex.get(id)?.price ?? 0;
}

/**
 * Ce qui est gratuit appartient a tout le monde : inutile de le stocker.
 * SAUF un exclusif de saison, dont le prix de 0 veut dire « ne se vend pas » :
 * il n'est qu'a qui l'a gagne sur le passe.
 */
export function isOwned(wardrobe: Wardrobe, id: string): boolean {
  const item = itemIndex.get(id);
  if (item === undefined) return false;
  if (isExclusive(id)) return wardrobe.owned.has(id);
  return item.price === 0 || wardrobe.owned.has(id);
}

export function defaultLook(): Look {
  return {
    outfit: OUTFITS.find((o) => o.price === 0 && o.exclusive === undefined)?.id ?? 'outfit.noir',
    hair: HAIRSTYLES.find((h) => h.price === 0)?.id ?? 'hair.court',
    skin: SKIN_TONES[0] ?? '#f3cfae',
    aura: AURA_COLORS.find((c) => c.price === 0 && c.exclusive === undefined)?.hex ?? '#ffcf3f',
    dances: {},
  };
}

const danceIndex = new Map(memeGallery().map((card) => [card.animationId, card]));

/** La danse equipee pour ce mouvement, ou `undefined` si c est celle offerte. */
export function danceFor(look: Look, move: Move): string | undefined {
  return look.dances[moveKey(move)];
}

/**
 * Equipe une danse pour son mouvement.
 *
 * Le mouvement se lit dans la carte du catalogue, jamais dans l identifiant
 * decoupe a la main : `anim.calme.t3.moonwalk` se laisse decouper, jusqu au
 * jour ou un slug contient un point.
 */
export function equipDance(wardrobe: Wardrobe, animationId: string): Wardrobe {
  const card = danceIndex.get(animationId);
  if (card === undefined) return wardrobe;
  if (!card.free && !wardrobe.owned.has(animationId)) return wardrobe;

  const key = moveKey({ style: card.style, tier: card.tier });
  if (wardrobe.look.dances[key] === animationId) return wardrobe;
  return {
    ...wardrobe,
    look: { ...wardrobe.look, dances: { ...wardrobe.look.dances, [key]: animationId } },
  };
}

/**
 * Fait d une danse la signature du joueur.
 *
 * Meme garde que `equipDance` : une danse de mouvement, offerte ou possedee.
 * Elle devient aussi la danse de SON mouvement — la galerie de l accueil
 * equipait deja ainsi, et le joueur qui la choisit veut la voir quand il joue
 * ce coup-la, pas seulement quand il gagne.
 */
export function equipSignature(wardrobe: Wardrobe, animationId: string): Wardrobe {
  const withDance = equipDance(wardrobe, animationId);
  const card = danceIndex.get(animationId);
  if (card === undefined || (!card.free && !wardrobe.owned.has(animationId))) return wardrobe;
  if (withDance.look.signature === animationId) return withDance;
  return { ...withDance, look: { ...withDance.look, signature: animationId } };
}

/** Ce que le joueur peut danser pour un mouvement, et ce qu il danse. */
export interface DanceOptions {
  /** L offerte d abord, puis celles possedees, dans l ordre du catalogue. */
  readonly choices: readonly MemeCard[];
  /** La danse equipee pour ce mouvement, ou l offerte. */
  readonly current: string;
  /** Celle qui vient apres, en bouclant : un seul geste pour changer en plein choix. */
  readonly next: string;
  /** Danses de ce mouvement encore a acheter : de quoi pointer vers la boutique. */
  readonly forSale: number;
}

/**
 * Les danses d un mouvement, vues du panneau de choix ou du vestiaire.
 *
 * On ne propose que ce qui se porte : l offerte et ce qui est possede. Le
 * reste se compte, pour dire qu il existe, mais ne s equipe pas — le serveur
 * le refuserait de toute facon.
 */
export function danceOptions(wardrobe: Wardrobe, move: Move): DanceOptions {
  const all = memeGallery().filter((card) => card.style === move.style && card.tier === move.tier);
  const choices = all.filter((card) => card.free || wardrobe.owned.has(card.animationId));
  const equipped = danceFor(wardrobe.look, move);
  const fallback = choices[0]?.animationId ?? '';
  const current =
    equipped !== undefined && choices.some((card) => card.animationId === equipped)
      ? equipped
      : fallback;
  const index = choices.findIndex((card) => card.animationId === current);
  const next = choices[(index + 1) % Math.max(1, choices.length)]?.animationId ?? current;
  return { choices, current, next, forSale: all.length - choices.length };
}

/** Vrai si cet identifiant est une danse de mouvement du catalogue. */
export function isDance(animationId: string): boolean {
  return danceIndex.has(animationId);
}

/**
 * La couleur d aura est portee par sa valeur, pas par son identifiant : le rig
 * a besoin d un hexadecimal, et le catalogue en est la seule source.
 */
const valueOf = (slot: LookSlot, id: string): string =>
  slot === 'aura' ? (AURA_COLORS.find((c) => c.id === id)?.hex ?? id) : id;

export function equip(wardrobe: Wardrobe, slot: LookSlot, id: string): Wardrobe {
  if (!isOwned(wardrobe, id)) return wardrobe;
  const value = valueOf(slot, id);
  if (wardrobe.look[slot] === value) return wardrobe;
  return { ...wardrobe, look: { ...wardrobe.look, [slot]: value } };
}

/** Cet objet est-il celui que le joueur porte dans cet emplacement ? */
export function isWorn(look: Look, slot: LookSlot, id: string): boolean {
  // La couleur se porte par sa valeur : comparer l identifiant au hexadecimal
  // ne marquait jamais aucune couleur comme portee.
  return look[slot] === valueOf(slot, id);
}

/** Un effet d aura, tel que le vestiaire le montre. */
export interface EffectItem {
  readonly id: string;
  readonly name: string;
  /** Le niveau d amplificateur qu il habille : il n apparait que la. */
  readonly level: AmplifierLevel;
  readonly price: number;
  /** Offert ou achete. Posseder un effet, c est le porter a son niveau. */
  readonly owned: boolean;
}

/**
 * Les huit effets d aura, pour le vestiaire.
 *
 * Il n y a rien a « equiper » : un effet habille UN niveau d amplificateur, et
 * le serveur le montre des qu on le possede et qu on joue ce niveau (docs/01
 * §3). Le vestiaire les montre donc pour les ESSAYER, et dire ou les trouver.
 */
export function effectItems(wardrobe: Wardrobe): readonly EffectItem[] {
  return AURA_EFFECTS.map((effect) => ({
    id: effect.id,
    name: effect.name.fr,
    level: effect.level,
    price: effect.price,
    owned: effect.price === 0 || wardrobe.owned.has(effect.id),
  }));
}

/** Nom et prix de n importe quel article : tenue, couleur, effet ou danse. */
export function itemInfo(id: string): { readonly name: string; readonly price: number } | null {
  const item = itemIndex.get(id);
  if (item !== undefined) return { name: item.name, price: item.price };
  const effect = AURA_EFFECTS.find((candidate) => candidate.id === id);
  if (effect !== undefined) return { name: effect.name.fr, price: effect.price };
  const dance = danceIndex.get(id);
  return dance === undefined ? null : { name: dance.name, price: dance.price };
}

/**
 * Le joueur a-t-il cet article, quel qu en soit le rayon ?
 *
 * Ce qui est offert appartient a tout le monde : la premiere danse de chaque
 * mouvement, les effets de base, les tenues a zero.
 */
export function ownsItem(wardrobe: Wardrobe, id: string): boolean {
  if (wardrobe.owned.has(id)) return true;
  // Un exclusif de saison ne se possede qu'une fois gagne : son prix de 0 veut
  // dire « ne se vend pas », pas « offert ».
  if (isExclusive(id)) return false;
  const info = itemInfo(id);
  if (info === null) return false;
  const dance = danceIndex.get(id);
  return dance === undefined ? info.price === 0 : dance.free;
}
