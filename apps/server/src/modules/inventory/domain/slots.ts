import { animationIdsFor, danceKey, STYLES, TIERS } from '@aura/content';
import type { CosmeticKind } from '@prisma/client';
import type { LoadoutData } from './ports.js';

/**
 * Ce qui a le droit d'aller dans chaque emplacement d'un equipement.
 *
 * **Une seule regle, deux lecteurs.** L'inventaire la tient a l'ECRITURE
 * (`equip` refuse `WRONG_SLOT`) ; le match la rejoue a la LECTURE
 * (`wearingFrom`), parce qu'un loadout ecrit avant ce controle peut ranger
 * n'importe quoi n'importe ou — et que ce qui sort de la part chez
 * l'adversaire, dans `opponent.cosmetics`.
 */

/** Le kind attendu par chaque emplacement d'apparence. */
export const SLOT_KINDS = Object.freeze({
  outfit: 'OUTFIT',
  hair: 'HAIR',
  auraColor: 'AURA_COLOR',
  auraEffect: 'AURA_EFFECT',
} as const satisfies Record<string, CosmeticKind>);

export type LookSlot = keyof typeof SLOT_KINDS;

/**
 * Le mouvement de chaque danse, par identifiant.
 *
 * Tire du catalogue de `@aura/content`, jamais d'un identifiant decoupe a la
 * main : c'est la meme table que le client lit pour jouer une danse, et la
 * meme cle (`danceKey`) que le runtime lit pour l'annoncer.
 */
const MOVE_OF_DANCE: ReadonlyMap<string, string> = new Map(
  STYLES.flatMap((style) =>
    TIERS.flatMap((tier) =>
      animationIdsFor({ style, tier }).map((id) => [id, danceKey({ style, tier })] as const),
    ),
  ),
);

/** Le kind d'un objet selon le catalogue, `undefined` s'il n'y figure pas. */
export type KindOf = (id: string) => CosmeticKind | undefined;

/**
 * Un objet va-t-il dans cet emplacement d'apparence ?
 *
 * Un objet que le catalogue ne connait pas ne va nulle part : on ne sait pas
 * ce qu'il est, donc on ne l'annonce pas.
 */
export function fitsLookSlot(slot: LookSlot, id: string, kindOf: KindOf): boolean {
  return kindOf(id) === SLOT_KINDS[slot];
}

/**
 * Une danse se range sous SON mouvement (`<style>.t<palier>`).
 *
 * Le client refusait deja de jouer une danse rangee ailleurs ; le runtime,
 * lui, l'annoncait telle quelle a la revelation. L'adversaire aurait vu un
 * palier 4 danse sur un palier 0 — un coup qui n'a pas ete joue.
 */
export function fitsDanceSlot(moveKey: string, id: string): boolean {
  return MOVE_OF_DANCE.get(id) === moveKey;
}

/** La signature se joue : ce doit etre une danse de mouvement, pas une couleur. */
export function fitsSignature(id: string): boolean {
  return MOVE_OF_DANCE.has(id);
}

/** Les emplacements d'apparence renseignes, dans un ordre stable. */
export function lookEntries(data: LoadoutData | null): readonly (readonly [LookSlot, string])[] {
  const slots = Object.keys(SLOT_KINDS) as LookSlot[];
  return slots.flatMap((slot) => {
    const id = data?.[slot];
    return id === undefined ? [] : [[slot, id] as const];
  });
}
