import { describe, expect, it } from 'vitest';
import { wardrobeFromInventory, WearingRefresh, wearingFrom } from './wearing.js';
import type { SeatWearing } from './match-runtime.js';

describe('wearingFrom', () => {
  it('garde ce qui est possede, emplacement par emplacement', () => {
    const worn = wearingFrom(['outfit.kimono', 'anim.hype.t2.floss', 'color.violet'], {
      outfit: 'outfit.kimono',
      auraColor: 'color.violet',
      signature: 'anim.hype.t2.floss',
      dances: { 'hype.t2': 'anim.hype.t2.floss' },
    });

    expect(worn.look).toEqual({
      outfit: 'outfit.kimono',
      auraColor: 'color.violet',
      signature: 'anim.hype.t2.floss',
    });
    expect(worn.dances).toEqual({ 'hype.t2': 'anim.hype.t2.floss' });
  });

  /*
    Ce qui sort d'ici part chez l'adversaire. Un objet retire du catalogue, ou
    une ligne de loadout ecrite avant une regle plus stricte, ne doit pas y
    arriver.
  */
  it('ecarte ce qui n est plus possede', () => {
    const worn = wearingFrom([], {
      hair: 'hair.long',
      signature: 'anim.hype.t2.floss',
      dances: { 'hype.t2': 'anim.hype.t2.floss' },
    });

    expect(worn.look).toEqual({});
    expect(worn.dances).toEqual({});
  });

  it('rend les defauts sans loadout', () => {
    expect(wearingFrom(['fx.glow'], null)).toEqual({
      ownedEffects: ['fx.glow'],
      dances: {},
      look: {},
    });
  });
});

describe('WearingRefresh', () => {
  const WORN: SeatWearing = {
    ownedEffects: [],
    dances: { 'hype.t2': 'anim.hype.t2.floss' },
    look: { signature: 'anim.hype.t2.floss' },
  };

  it('met a jour la session et les danses du match en cours', async () => {
    const sessions: [string, SeatWearing][] = [];
    const matches: [string, Readonly<Record<string, string>>][] = [];
    const refresh = new WearingRefresh(
      { wearingOf: () => Promise.resolve(WORN) },
      { setWearing: (id, w) => sessions.push([id, w]) },
      { refreshDances: (id, d) => matches.push([id, d]) },
    );

    await refresh.changed('p1');

    expect(sessions).toEqual([['p1', WORN]]);
    expect(matches).toEqual([['p1', WORN.dances]]);
  });

  it('ne leve pas quand l inventaire ne repond pas, et le dit', async () => {
    const warnings: string[] = [];
    const refresh = new WearingRefresh(
      { wearingOf: () => Promise.reject(new Error('base indisponible')) },
      { setWearing: () => undefined },
      { refreshDances: () => undefined },
      { warn: (message) => warnings.push(message) },
    );

    await expect(refresh.changed('p1')).resolves.toBeUndefined();
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('p1');
  });
});

describe('wardrobeFromInventory', () => {
  /*
    Le defaut qu'on a eu : l'inventaire en base ne contient que les ACHATS.
    La tenue offerte et la danse offerte etaient donc « non possedees » et
    retirees de l'apparence annoncee — l'adversaire voyait toujours les
    defauts, signature comprise.
  */
  it('compte les objets offerts comme possedes', async () => {
    const wardrobe = wardrobeFromInventory({
      read: () =>
        Promise.resolve({
          wallet: { soft: 0, hard: 0 },
          owned: [],
          loadout: { outfit: 'outfit.blanc', signature: 'anim.calme.t2.lookaway' },
        }),
      catalogue: () =>
        Promise.resolve(
          (
            [
              ['outfit.blanc', 'OUTFIT'],
              ['anim.calme.t2.lookaway', 'ANIMATION'],
            ] as const
          ).map(([id, kind]) => ({
            id,
            kind,
            rarity: 'default',
            priceSoft: 0,
            priceHard: null,
            availableFrom: null,
            availableTo: null,
          })),
        ),
    });

    expect((await wardrobe.wearingOf('p1')).look).toEqual({
      outfit: 'outfit.blanc',
      signature: 'anim.calme.t2.lookaway',
    });
  });
});
