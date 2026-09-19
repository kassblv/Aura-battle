import { EMOTES, EMOTE_SLOTS } from '@aura/content';

/**
 * La roue d emotes.
 *
 * Quatre emplacements, parce qu une roue se vise au pouce : au-dela, on ouvre
 * un menu au lieu de reagir, et une emote qui arrive trois secondes trop tard
 * ne dit plus rien.
 */

export interface EmoteLoadout {
  /** Les emplacements, dans l ordre de la roue. */
  readonly slots: readonly string[];
  /** Identifiants possedes. Ce qui est offert n a pas besoin d y figurer. */
  readonly owned: ReadonlySet<string>;
}

const isOwned = (loadout: EmoteLoadout, id: string): boolean => {
  const emote = EMOTES.find((candidate) => candidate.id === id);
  if (emote === undefined) return false;
  return emote.price === 0 || loadout.owned.has(id);
};

/** La roue de depart : les quatre emotes offertes. */
export function defaultEmotes(): readonly string[] {
  return EMOTES.filter((emote) => emote.price === 0)
    .slice(0, EMOTE_SLOTS)
    .map((emote) => emote.id);
}

/**
 * Pose une emote dans un emplacement.
 *
 * Si elle occupe deja un autre emplacement, les deux s echangent plutot que de
 * la dupliquer : deux emplacements identiques, c est un emplacement perdu, et
 * le joueur ne s en apercoit qu en plein match.
 */
export function equipEmote(loadout: EmoteLoadout, slot: number, id: string): EmoteLoadout {
  if (!Number.isInteger(slot) || slot < 0 || slot >= EMOTE_SLOTS) return loadout;
  if (!isOwned(loadout, id)) return loadout;
  if (loadout.slots[slot] === id) return loadout;

  const slots = [...loadout.slots];
  const existing = slots.indexOf(id);
  if (existing >= 0) slots[existing] = slots[slot] ?? id;
  slots[slot] = id;
  return { ...loadout, slots };
}
