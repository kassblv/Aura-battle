import { discountedPrice, SEASON_PASS, type SeasonPass } from '@aura/content';
import { describe, expect, it } from 'vitest';
import type { CatalogueEntry } from '../../inventory/domain/purchase.js';
import {
  claimAll,
  claimOutcome,
  OWNED_ITEM_MIN_COINS,
  premiumOutcome,
  type ClaimContext,
} from './claim.js';

/**
 * La regle de reclamation du passe de saison, sans base.
 *
 * Un passe reduit a quatre paliers, pour que chaque cas se lise d'un coup
 * d'oeil : pieces, jetons, un objet vendu et un objet offert a tous.
 */

const PASS: SeasonPass = {
  xpPerTier: 100,
  premiumPrice: 500,
  tiers: [
    { tier: 1, free: { kind: 'coins', amount: 40 }, premium: { kind: 'item', itemId: 'fx.shock' } },
    { tier: 2, free: { kind: 'tokens', amount: 5 }, premium: { kind: 'coins', amount: 60 } },
    {
      tier: 3,
      free: { kind: 'item', itemId: 'color.violet' },
      premium: { kind: 'tokens', amount: 20 },
    },
    {
      tier: 4,
      free: { kind: 'item', itemId: 'color.gold' },
      premium: { kind: 'item', itemId: 'anim.pas.encore.seed' },
    },
  ],
};

const entry = (id: string, rarity: string, priceSoft: number | null): CatalogueEntry => ({
  id,
  kind: 'AURA_COLOR',
  rarity,
  priceSoft,
  priceHard: null,
  availableFrom: null,
  availableTo: null,
});

const CATALOGUE: readonly CatalogueEntry[] = [
  { ...entry('fx.shock', 'epic', 850), kind: 'AURA_EFFECT' },
  entry('color.violet', 'common', 80),
  // Offert a tous : possede par tout le monde, prix nul.
  entry('color.gold', 'default', 0),
];

const context = (overrides: Partial<ClaimContext> = {}): ClaimContext => ({
  xp: 0,
  premium: false,
  claimed: [],
  owned: [],
  catalogue: CATALOGUE,
  pass: PASS,
  ...overrides,
});

describe('claimOutcome', () => {
  it('accorde les pieces d un palier atteint', () => {
    expect(claimOutcome({ tier: 1, track: 'free' }, context({ xp: 100 }))).toEqual({
      ok: true,
      grant: { tier: 1, track: 'free', coins: 40, tokens: 0, itemId: null, fallbackCoins: 0 },
    });
  });

  it('accorde les jetons d un palier atteint', () => {
    const outcome = claimOutcome({ tier: 2, track: 'free' }, context({ xp: 250 }));
    expect(outcome).toMatchObject({ ok: true, grant: { coins: 0, tokens: 5, itemId: null } });
  });

  it('refuse un palier que l XP n atteint pas', () => {
    // 199 XP : palier 1 seulement. La frontiere est exacte.
    expect(claimOutcome({ tier: 2, track: 'free' }, context({ xp: 199 }))).toEqual({
      ok: false,
      reason: 'TIER_LOCKED',
    });
    expect(claimOutcome({ tier: 2, track: 'free' }, context({ xp: 200 })).ok).toBe(true);
  });

  it('refuse la piste premium a qui ne l a pas', () => {
    expect(claimOutcome({ tier: 2, track: 'premium' }, context({ xp: 400 }))).toEqual({
      ok: false,
      reason: 'PREMIUM_REQUIRED',
    });
  });

  /*
    « Palier non atteint » passe avant « premium requis » : dire au joueur
    d'acheter la piste pour un palier qu'elle ne lui donnerait pas encore
    serait pousser a une depense qui ne rend rien tout de suite.
  */
  it('dit d abord que le palier n est pas atteint, avant le premium', () => {
    expect(claimOutcome({ tier: 3, track: 'premium' }, context({ xp: 100 }))).toEqual({
      ok: false,
      reason: 'TIER_LOCKED',
    });
  });

  it('accorde la piste premium a qui l a', () => {
    const outcome = claimOutcome(
      { tier: 2, track: 'premium' },
      context({ xp: 400, premium: true }),
    );
    expect(outcome).toMatchObject({ ok: true, grant: { coins: 60, track: 'premium' } });
  });

  it('refuse une recompense deja reclamee, sur sa piste seulement', () => {
    const claimed = [{ tier: 1, track: 'free' as const }];
    expect(claimOutcome({ tier: 1, track: 'free' }, context({ xp: 100, claimed }))).toEqual({
      ok: false,
      reason: 'ALREADY_CLAIMED',
    });
    expect(
      claimOutcome({ tier: 1, track: 'premium' }, context({ xp: 100, claimed, premium: true })).ok,
    ).toBe(true);
  });

  it('refuse un palier que le passe ne connait pas', () => {
    expect(claimOutcome({ tier: 5, track: 'free' }, context({ xp: 10_000 }))).toEqual({
      ok: false,
      reason: 'UNKNOWN_TIER',
    });
    expect(claimOutcome({ tier: 0, track: 'free' }, context({ xp: 10_000 })).ok).toBe(false);
  });

  it('refuse une piste inconnue', () => {
    const outcome = claimOutcome(
      { tier: 1, track: 'gold' as never },
      context({ xp: 100, premium: true }),
    );
    expect(outcome).toEqual({ ok: false, reason: 'UNKNOWN_TIER' });
  });

  it('accorde un cosmetique que le joueur n a pas, avec son prix en repli', () => {
    const outcome = claimOutcome({ tier: 3, track: 'free' }, context({ xp: 300 }));
    expect(outcome).toEqual({
      ok: true,
      grant: {
        tier: 3,
        track: 'free',
        coins: 0,
        tokens: 0,
        itemId: 'color.violet',
        // Si un achat passe entre la lecture et l'ecriture : les pieces, au prix
        // le plus bas auquel on peut l'acheter (vitrine).
        fallbackCoins: discountedPrice(80),
      },
    });
  });

  /*
    Au prix de la VITRINE, jamais au prix plein : sinon acheter l'objet a
    -30 % en vitrine puis le reclamer sur le passe rendait le prix plein, et
    creait des pieces a chaque saison (relecture de securite).
  */
  it('change un cosmetique deja possede en pieces, au prix le plus bas de la boutique', () => {
    const outcome = claimOutcome(
      { tier: 3, track: 'free' },
      context({ xp: 300, owned: ['color.violet'] }),
    );
    expect(outcome).toMatchObject({
      ok: true,
      grant: { coins: discountedPrice(80), itemId: null },
    });
  });

  it('ne rend jamais plus que ce que coute l objet en vitrine, meme rare', () => {
    const outcome = claimOutcome(
      { tier: 1, track: 'premium' },
      context({ xp: 100, premium: true, owned: ['fx.shock'] }),
    );
    expect(outcome).toMatchObject({
      ok: true,
      grant: { coins: discountedPrice(850), itemId: null },
    });
  });

  /*
    Un objet offert a tous est possede par tout le monde et vaut zero piece :
    la recompense tomberait a vide. Elle vaut au moins une recompense de
    pieces ordinaire — jamais rien (docs/01).
  */
  it('ne rend jamais une recompense vide pour un objet offert', () => {
    const outcome = claimOutcome({ tier: 4, track: 'free' }, context({ xp: 400 }));
    expect(outcome).toMatchObject({
      ok: true,
      grant: { coins: OWNED_ITEM_MIN_COINS, itemId: null },
    });
    expect(OWNED_ITEM_MIN_COINS).toBeGreaterThan(0);
  });

  /*
    Un objet absent du catalogue (contenu pas encore semé) ne peut pas etre
    ecrit — la cle etrangere le refuserait et la reclamation tomberait en
    panne. Il se change en pieces, comme un objet deja possede.
  */
  it('change en pieces un objet que le catalogue ne connait pas', () => {
    const outcome = claimOutcome(
      { tier: 4, track: 'premium' },
      context({ xp: 400, premium: true }),
    );
    expect(outcome).toMatchObject({
      ok: true,
      grant: { coins: OWNED_ITEM_MIN_COINS, itemId: null },
    });
  });

  it('ne tient pas compte d une XP invalide', () => {
    expect(claimOutcome({ tier: 1, track: 'free' }, context({ xp: -500 })).ok).toBe(false);
    expect(claimOutcome({ tier: 1, track: 'free' }, context({ xp: Number.NaN })).ok).toBe(false);
  });

  it('suit le vrai passe par defaut', () => {
    const { pass: _ignored, ...rest } = context({ xp: 100 });
    const outcome = claimOutcome({ tier: 1, track: 'free' }, rest);
    expect(outcome.ok).toBe(true);
    expect(SEASON_PASS.tiers[0]?.free).toEqual({ kind: 'coins', amount: 40 });
  });
});

describe('claimAll', () => {
  it('ne rend que la piste gratuite sans premium, jusqu au palier atteint', () => {
    const grants = claimAll(context({ xp: 250 }));
    expect(grants.map((g) => [g.tier, g.track])).toEqual([
      [1, 'free'],
      [2, 'free'],
    ]);
  });

  it('rend les deux pistes avec le premium, sans ce qui est deja reclame', () => {
    const grants = claimAll(
      context({ xp: 300, premium: true, claimed: [{ tier: 2, track: 'free' }] }),
    );
    expect(grants.map((g) => [g.tier, g.track])).toEqual([
      [1, 'free'],
      [1, 'premium'],
      [2, 'premium'],
      [3, 'free'],
      [3, 'premium'],
    ]);
  });

  it('ne rend rien avant le premier palier', () => {
    expect(claimAll(context({ xp: 99, premium: true }))).toEqual([]);
  });

  /* Le meme objet deux fois dans un lot : le second se change en pieces. */
  it('tient pour possede ce qu il vient d accorder dans le meme lot', () => {
    const pass: SeasonPass = {
      ...PASS,
      tiers: [
        {
          tier: 1,
          free: { kind: 'item', itemId: 'color.violet' },
          premium: { kind: 'item', itemId: 'color.violet' },
        },
      ],
    };
    const grants = claimAll(context({ xp: 100, premium: true, pass }));
    expect(grants.map((g) => [g.itemId, g.coins])).toEqual([
      ['color.violet', 0],
      [null, discountedPrice(80)],
    ]);
  });

  it('s arrete au dernier palier du passe', () => {
    expect(claimAll(context({ xp: 1_000_000 })).length).toBe(PASS.tiers.length);
  });
});

describe('premiumOutcome', () => {
  it('debite exactement le prix de la piste, en jetons', () => {
    expect(premiumOutcome({ wallet: { soft: 0, hard: 500 }, premium: false }, PASS)).toEqual({
      ok: true,
      spend: { soft: 0, hard: 500 },
    });
  });

  it('refuse sans assez de jetons, quelles que soient les pieces', () => {
    expect(premiumOutcome({ wallet: { soft: 99_999, hard: 499 }, premium: false }, PASS)).toEqual({
      ok: false,
      reason: 'INSUFFICIENT_FUNDS',
    });
  });

  it('refuse a qui a deja la piste, avant de parler d argent', () => {
    expect(premiumOutcome({ wallet: { soft: 0, hard: 0 }, premium: true }, PASS)).toEqual({
      ok: false,
      reason: 'ALREADY_PREMIUM',
    });
  });

  it('suit le prix du vrai passe par defaut', () => {
    expect(premiumOutcome({ wallet: { soft: 0, hard: 10_000 }, premium: false })).toEqual({
      ok: true,
      spend: { soft: 0, hard: SEASON_PASS.premiumPrice },
    });
  });
});
