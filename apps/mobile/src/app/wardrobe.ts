import { AURA_COLORS, HAIRSTYLES, OUTFITS, SKIN_TONES } from '@aura/content';

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

/** Ce qui est gratuit appartient a tout le monde : inutile de le stocker. */
export function isOwned(wardrobe: Wardrobe, id: string): boolean {
  const item = itemIndex.get(id);
  if (item === undefined) return false;
  return item.price === 0 || wardrobe.owned.has(id);
}

export function defaultLook(): Look {
  return {
    outfit: OUTFITS.find((o) => o.price === 0)?.id ?? 'outfit.noir',
    hair: HAIRSTYLES.find((h) => h.price === 0)?.id ?? 'hair.court',
    skin: SKIN_TONES[0] ?? '#f3cfae',
    aura: AURA_COLORS.find((c) => c.price === 0)?.hex ?? '#ffcf3f',
  };
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
