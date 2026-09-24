import { animationIdsFor } from '@aura/content';
import type { CosmeticKind } from '@prisma/client';
import { describe, expect, it } from 'vitest';
import { wardrobeFromInventory, WearingRefresh, wearingFrom } from './wearing.js';
import type { InventorySnapshot } from '../../inventory/domain/ports.js';
import type { SeatWearing } from './match-runtime.js';

/** Le kind de chaque objet, tel que le catalogue le donne. */
const KINDS: ReadonlyMap<string, CosmeticKind> = new Map<string, CosmeticKind>([
  ['outfit.kimono', 'OUTFIT'],
  ['hair.long', 'HAIR'],
  ['color.violet', 'AURA_COLOR'],
  ['fx.glow', 'AURA_EFFECT'],
  ['anim.hype.t2.floss', 'ANIMATION'],
  ['anim.acrobatie.t4.backflip', 'ANIMATION'],
]);

describe('wearingFrom', () => {
  it('garde ce qui est possede, emplacement par emplacement', () => {
    const worn = wearingFrom(
      ['outfit.kimono', 'anim.hype.t2.floss', 'color.violet'],
      {
        outfit: 'outfit.kimono',
        auraColor: 'color.violet',
        signature: 'anim.hype.t2.floss',
        dances: { 'hype.t2': 'anim.hype.t2.floss' },
      },
      KINDS,
    );

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
    const worn = wearingFrom(
      [],
      {
        hair: 'hair.long',
        signature: 'anim.hype.t2.floss',
        dances: { 'hype.t2': 'anim.hype.t2.floss' },
      },
      KINDS,
    );

    expect(worn.look).toEqual({});
    expect(worn.dances).toEqual({});
  });

  /*
    Un loadout ANCIEN, ecrit avant le controle des emplacements, peut ranger
    n'importe quoi n'importe ou. Il ne doit rien annoncer de faux : ni une
    danse en couleur d'aura, ni un palier 4 danse sous `calme.t0`.
  */
  it('ecarte ce qui est range dans le mauvais emplacement', () => {
    const backflip = animationIdsFor({ style: 'acrobatie', tier: 4 }).find((id) =>
      id.endsWith('.backflip'),
    )!;
    const worn = wearingFrom(
      ['outfit.kimono', 'color.violet', 'hair.long', 'anim.hype.t2.floss', backflip],
      {
        outfit: 'color.violet',
        hair: 'anim.hype.t2.floss',
        auraColor: 'anim.hype.t2.floss',
        signature: 'color.violet',
        dances: { 'calme.t0': backflip, 'hype.t2': 'hair.long' },
      },
      KINDS,
    );

    expect(worn.look).toEqual({});
    expect(worn.dances).toEqual({});
  });

  it('ecarte un objet dont le catalogue ignore le kind', () => {
    const worn = wearingFrom(['outfit.inconnue'], { outfit: 'outfit.inconnue' }, KINDS);
    expect(worn.look).toEqual({});
  });

  it('rend les defauts sans loadout', () => {
    expect(wearingFrom(['fx.glow'], null, KINDS)).toEqual({
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
    const given: InventorySnapshot[] = [];
    const refresh = new WearingRefresh(
      {
        wearingFor: (snapshot) => {
          given.push(snapshot);
          return Promise.resolve(WORN);
        },
      },
      { setWearing: (id, w) => sessions.push([id, w]) },
      { refreshDances: (id, d) => matches.push([id, d]) },
    );

    const snapshot = {
      owned: ['anim.hype.t2.floss'],
      loadout: { signature: 'anim.hype.t2.floss' },
    };
    await refresh.changed('p1', snapshot);

    // L'etat que l'inventaire vient d'ecrire, pas une relecture de la base.
    expect(given).toEqual([snapshot]);
    expect(sessions).toEqual([['p1', WORN]]);
    expect(matches).toEqual([['p1', WORN.dances]]);
  });

  it('ne leve pas quand l inventaire ne repond pas, et le dit', async () => {
    const warnings: string[] = [];
    const refresh = new WearingRefresh(
      { wearingFor: () => Promise.reject(new Error('base indisponible')) },
      { setWearing: () => undefined },
      { refreshDances: () => undefined },
      { warn: (message) => warnings.push(message) },
    );

    await expect(refresh.changed('p1', { owned: [], loadout: null })).resolves.toBeUndefined();
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('p1');
  });
});

describe('wardrobeFromInventory', () => {
  /* Le rafraichissement part de l'etat deja lu : il ne relit que le catalogue. */
  it('calcule l apparence d un etat donne sans relire l inventaire', async () => {
    let reads = 0;
    const wardrobe = wardrobeFromInventory({
      read: () => {
        reads += 1;
        return Promise.reject(new Error('ne doit pas etre appele'));
      },
      catalogue: () =>
        Promise.resolve([
          {
            id: 'outfit.kimono',
            kind: 'OUTFIT' as const,
            rarity: 'common',
            priceSoft: 300,
            priceHard: null,
            availableFrom: null,
            availableTo: null,
          },
        ]),
    });

    const worn = await wardrobe.wearingFor({
      owned: ['outfit.kimono'],
      loadout: { outfit: 'outfit.kimono' },
    });
    expect(worn.look).toEqual({ outfit: 'outfit.kimono' });
    expect(reads).toBe(0);
  });

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
