import { EMOTES, EMOTE_SLOTS } from '@aura/content';
import { describe, expect, it } from 'vitest';
import { defaultEmotes, equipEmote, type EmoteLoadout } from './emotes.js';

const owned = (...ids: string[]): ReadonlySet<string> => new Set(ids);

describe('defaultEmotes', () => {
  it('remplit toute la roue avec des emotes offertes', () => {
    const wheel = defaultEmotes();
    expect(wheel).toHaveLength(EMOTE_SLOTS);
    for (const id of wheel) {
      expect(EMOTES.find((emote) => emote.id === id)?.price).toBe(0);
    }
  });

  it('ne met pas deux fois la meme', () => {
    expect(new Set(defaultEmotes()).size).toBe(EMOTE_SLOTS);
  });
});

describe('equipEmote', () => {
  const wheel = (): EmoteLoadout => ({ slots: defaultEmotes(), owned: owned('emote.flamme') });

  it('pose une emote possedee dans l emplacement demande', () => {
    const next = equipEmote(wheel(), 1, 'emote.flamme');
    expect(next.slots[1]).toBe('emote.flamme');
  });

  it('refuse une emote qu on ne possede pas', () => {
    const before = wheel();
    expect(equipEmote(before, 0, 'emote.licorne')).toBe(before);
  });

  it('accepte une emote offerte sans la posseder', () => {
    const bare: EmoteLoadout = { slots: defaultEmotes(), owned: owned() };
    expect(equipEmote(bare, 0, 'emote.bravo').slots[0]).toBe('emote.bravo');
  });

  it('refuse un emplacement hors de la roue', () => {
    const before = wheel();
    expect(equipEmote(before, EMOTE_SLOTS, 'emote.flamme')).toBe(before);
    expect(equipEmote(before, -1, 'emote.flamme')).toBe(before);
  });

  /**
   * Une emote deja posee ailleurs change de place au lieu d'apparaitre deux
   * fois. Deux emplacements identiques, c'est un emplacement perdu — et le
   * joueur ne s'en apercoit qu'en plein match.
   */
  it('deplace une emote deja dans la roue au lieu de la dupliquer', () => {
    const before = wheel();
    const first = before.slots[0];
    if (first === undefined) throw new Error('roue vide');
    const next = equipEmote(before, 2, first);
    expect(next.slots[2]).toBe(first);
    expect(next.slots.filter((id) => id === first)).toHaveLength(1);
    // L'ancien emplacement recoit celle qui occupait le nouveau : rien ne se perd.
    expect(next.slots[0]).toBe(before.slots[2]);
  });

  it('ne fabrique pas un nouvel etat quand rien ne change', () => {
    const before = wheel();
    const first = before.slots[0];
    if (first === undefined) throw new Error('roue vide');
    expect(equipEmote(before, 0, first)).toBe(before);
  });

  it('refuse une emote inconnue', () => {
    const before = wheel();
    expect(equipEmote(before, 0, 'emote.inventee')).toBe(before);
  });
});
