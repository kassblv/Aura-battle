import { describe, expect, it } from 'vitest';
import {
  AURA_COLORS,
  AURA_EFFECTS,
  discountedPrice,
  featuredForDay,
  HAIRSTYLES,
  OUTFITS,
} from '@aura/content';
import {
  isOffered,
  ownedWithFree,
  PURCHASABLE_KINDS,
  purchaseOutcome,
  type CatalogueEntry,
  type Wallet,
} from './purchase.js';

/** Tout ce qui a un prix : la reserve dans laquelle la vitrine puise. */
const PAID_IDS = [...AURA_EFFECTS, ...AURA_COLORS, ...HAIRSTYLES, ...OUTFITS]
  .filter((entry) => entry.price > 0)
  .map((entry) => entry.id);

const item = (over: Partial<CatalogueEntry> = {}): CatalogueEntry => ({
  id: 'color.violet',
  kind: 'AURA_COLOR',
  rarity: 'common',
  priceSoft: 80,
  priceHard: null,
  availableFrom: null,
  availableTo: null,
  ...over,
});

const NOW = new Date('2026-09-21T10:00:00Z');
const RICH: Wallet = { soft: 1_000, hard: 10 };

describe('purchaseOutcome', () => {
  it('accepte un achat payable et non possede', () => {
    expect(purchaseOutcome({ item: item(), wallet: RICH, owned: false, now: NOW })).toEqual({
      ok: true,
      spend: { soft: 80, hard: 0 },
    });
  });

  it('refuse ce qu on possede deja', () => {
    expect(purchaseOutcome({ item: item(), wallet: RICH, owned: true, now: NOW })).toEqual({
      ok: false,
      reason: 'ALREADY_OWNED',
    });
  });

  it('refuse faute d argent', () => {
    expect(
      purchaseOutcome({ item: item(), wallet: { soft: 79, hard: 0 }, owned: false, now: NOW }),
    ).toEqual({ ok: false, reason: 'INSUFFICIENT_FUNDS' });
  });

  it('accepte au centime pres', () => {
    expect(
      purchaseOutcome({ item: item(), wallet: { soft: 80, hard: 0 }, owned: false, now: NOW }).ok,
    ).toBe(true);
  });

  /*
    REGLE D'OR N°3, et c'est ici qu'elle se tient.

    Tout ce qui modifie un score est accessible a tous. La boutique ne vend que
    de l'apparence. Cette liste est donc une GARDE, pas une intention : un
    `CosmeticKind` ajoute demain n'est pas vendable tant que personne ne l'a
    ecrit ici, et le test ci-dessous se casse si quelqu'un elargit la liste
    sans y penser.
  */
  it('ne vend que de l apparence', () => {
    expect([...PURCHASABLE_KINDS].sort()).toEqual([
      'ANIMATION',
      'AURA_COLOR',
      'AURA_EFFECT',
      'BANNER',
      'HAIR',
      'OUTFIT',
    ]);
  });

  it('refuse un genre qui n est pas vendable', () => {
    expect(
      purchaseOutcome({
        item: item({ kind: 'BOOST' as never }),
        wallet: RICH,
        owned: false,
        now: NOW,
      }),
    ).toEqual({ ok: false, reason: 'NOT_PURCHASABLE' });
  });

  /*
    Un objet sans prix n'est pas gratuit : il n'est pas a vendre. Un `null`
    traite comme un zero offrirait le catalogue entier a qui trouve la ligne
    ou le prix a ete oublie.
  */
  it('refuse un objet sans prix', () => {
    expect(
      purchaseOutcome({
        item: item({ priceSoft: null, priceHard: null }),
        wallet: RICH,
        owned: false,
        now: NOW,
      }),
    ).toEqual({ ok: false, reason: 'NOT_PURCHASABLE' });
  });

  it('accepte un objet a zero', () => {
    expect(
      purchaseOutcome({
        item: item({ priceSoft: 0 }),
        wallet: { soft: 0, hard: 0 },
        owned: false,
        now: NOW,
      }),
    ).toEqual({ ok: true, spend: { soft: 0, hard: 0 } });
  });

  /*
    Deux monnaies, et la douce d'abord. Quelqu'un qui a gagne de quoi se payer
    un objet en jouant ne doit pas se voir prelever la monnaie qu'il a achetee.
  */
  it('depense la monnaie douce avant la dure', () => {
    expect(
      purchaseOutcome({
        item: item({ priceSoft: 80, priceHard: 2 }),
        wallet: RICH,
        owned: false,
        now: NOW,
      }),
    ).toEqual({ ok: true, spend: { soft: 80, hard: 0 } });
  });

  it('se rabat sur la monnaie dure quand la douce ne suffit pas', () => {
    expect(
      purchaseOutcome({
        item: item({ priceSoft: 80, priceHard: 2 }),
        wallet: { soft: 10, hard: 5 },
        owned: false,
        now: NOW,
      }),
    ).toEqual({ ok: true, spend: { soft: 0, hard: 2 } });
  });

  describe('fenetre de disponibilite', () => {
    it('refuse avant l ouverture', () => {
      expect(
        purchaseOutcome({
          item: item({ availableFrom: new Date('2026-09-22T00:00:00Z') }),
          wallet: RICH,
          owned: false,
          now: NOW,
        }),
      ).toEqual({ ok: false, reason: 'UNAVAILABLE' });
    });

    it('refuse apres la fermeture', () => {
      expect(
        purchaseOutcome({
          item: item({ availableTo: new Date('2026-09-20T00:00:00Z') }),
          wallet: RICH,
          owned: false,
          now: NOW,
        }),
      ).toEqual({ ok: false, reason: 'UNAVAILABLE' });
    });

    it('accepte pendant la fenetre', () => {
      expect(
        purchaseOutcome({
          item: item({
            availableFrom: new Date('2026-09-20T00:00:00Z'),
            availableTo: new Date('2026-09-22T00:00:00Z'),
          }),
          wallet: RICH,
          owned: false,
          now: NOW,
        }).ok,
      ).toBe(true);
    });
  });

  /*
    L'ordre des refus compte.

    « Tu possedes deja ca » avant « tu n'as pas assez » : quelqu'un qui possede
    l'objet et n'a pas d'argent doit lire le premier, pas le second — sinon il
    va gagner de l'argent pour racheter ce qu'il a.
  */
  it('dit d abord ce qui est le plus utile a savoir', () => {
    expect(
      purchaseOutcome({
        item: item(),
        wallet: { soft: 0, hard: 0 },
        owned: true,
        now: NOW,
      }),
    ).toEqual({ ok: false, reason: 'ALREADY_OWNED' });
  });
});

/**
 * La vitrine du jour.
 *
 * Le prix remise se decide ICI, avec le prix plein : c'est le serveur qui
 * facture, et la regle d'or n°1 veut que le client n'envoie qu'une intention.
 * Un client qui annoncerait « cet article est en vitrine » acheterait tout a
 * moins trente pour cent.
 */
describe('vitrine du jour', () => {
  const DAY = 20_718;
  const [enVitrine] = featuredForDay(DAY);
  const horsVitrine = PAID_IDS.find((id) => !featuredForDay(DAY).includes(id));

  const buy = (id: string, soft: number): ReturnType<typeof purchaseOutcome> =>
    purchaseOutcome({
      item: item({ id, priceSoft: 100 }),
      wallet: { soft, hard: 0 },
      owned: false,
      now: NOW,
      day: DAY,
    });

  it('facture le prix remise pour un article en vitrine', () => {
    const outcome = buy(enVitrine ?? '', 1_000);
    expect(outcome.ok && outcome.spend.soft).toBe(discountedPrice(100));
  });

  it('facture le prix plein pour un article qui n y est pas', () => {
    const outcome = buy(horsVitrine ?? '', 1_000);
    expect(outcome.ok && outcome.spend.soft).toBe(100);
  });

  /*
    Le prix remise decide AUSSI de ce qu'on peut se payer. Juger les fonds sur
    le prix plein puis debiter le prix remise refuserait un achat que le joueur
    peut s'offrir ; l'inverse le laisserait passer a decouvert.
  */
  it('juge les fonds sur le prix reellement facture', () => {
    const juste = discountedPrice(100);
    expect(buy(enVitrine ?? '', juste).ok).toBe(true);
    expect(buy(enVitrine ?? '', juste - 1).ok).toBe(false);
  });

  /*
    La vitrine d'HIER ne vaut plus. Sans le jour en parametre, garder l'ecran
    ouvert par-dessus minuit suffirait a payer le prix remise le lendemain.
  */
  it('ne remise pas sur la vitrine de la veille', () => {
    const [hier] = featuredForDay(DAY - 1);
    const outcome = buy(hier ?? '', 1_000);
    expect(outcome.ok && outcome.spend.soft).toBe(100);
  });

  /*
    Sans jour fourni — un appelant qui ne s'occupe pas de la vitrine — c'est le
    prix plein. Le defaut doit etre celui qui ne donne rien, jamais celui qui
    offre une remise a tout le monde.
  */
  it('facture le prix plein quand aucun jour n est donne', () => {
    const outcome = purchaseOutcome({
      item: item({ id: enVitrine ?? '', priceSoft: 100 }),
      wallet: RICH,
      owned: false,
      now: NOW,
    });
    expect(outcome.ok && outcome.spend.soft).toBe(100);
  });
});

describe('ownedWithFree', () => {
  /** Ce qui est offert pour de bon : rarete par defaut, zero, sans condition. */
  const offered = (over: Partial<CatalogueEntry> = {}): CatalogueEntry =>
    item({ id: 'color.gold', rarity: 'default', priceSoft: 0, ...over });

  it('ajoute ce qui est offert, sans doublon', () => {
    expect(ownedWithFree(['color.gold', 'color.violet'], [offered(), item()])).toEqual([
      'color.gold',
      'color.violet',
    ]);
    expect(ownedWithFree([], [offered(), item()])).toEqual(['color.gold']);
  });

  /*
    Les deux chemins disaient le contraire l'un de l'autre.

    `purchaseOutcome` refusait un objet hors de sa fenetre (`UNAVAILABLE`), ou
    d'un kind qu'on ne vend pas ; `ownedWithFree` le donnait quand meme a tout
    le monde des que son prix doux valait zero. Un objet d'evenement a zero
    piece, reserve a une semaine, etait donc possede par tous, pour toujours.
  */
  it.each([
    ['vendu en monnaie forte', { priceHard: 50 }],
    ['pas encore disponible', { availableFrom: new Date('2027-01-01T00:00:00Z') }],
    ['plus disponible', { availableTo: new Date('2026-01-01T00:00:00Z') }],
    // Une fenetre ouverte AUJOURD'HUI ne suffit pas : l'offert n'expire pas.
    ['limite dans le temps', { availableFrom: new Date(0), availableTo: new Date('2099-01-01') }],
    ['d une rarete payante', { rarity: 'legendary' }],
    ['d un kind qu on ne vend pas', { kind: 'BOOST' as never }],
    ['sans prix', { priceSoft: null }],
  ])('n offre pas un objet %s', (_why, over: Partial<CatalogueEntry>) => {
    expect(isOffered(offered(over))).toBe(false);
    expect(ownedWithFree([], [offered(over)])).toEqual([]);
  });

  it('offre un objet par defaut, a zero, sans condition', () => {
    expect(isOffered(offered())).toBe(true);
  });

  /* Ce qui a ete ACHETE reste possede, quelles que soient ses conditions. */
  it('garde ce qui est en base meme hors des conditions de l offert', () => {
    expect(ownedWithFree(['fx.event'], [offered({ id: 'fx.event', priceHard: 50 })])).toEqual([
      'fx.event',
    ]);
  });
});
