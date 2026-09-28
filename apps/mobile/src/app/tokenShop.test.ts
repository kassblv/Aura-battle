import { TOKEN_PACKS } from '@aura/content';
import { describe, expect, it } from 'vitest';
import { noticeAfterWallet, tokenOffers } from './tokenShop.js';

describe('tokenOffers', () => {
  it('joint chaque pack a son prix du store, dans l ordre des packs', () => {
    const products = [...TOKEN_PACKS]
      .reverse()
      .map((pack, i) => ({ identifier: pack.productId, priceString: `${String(i)},99 €` }));
    const offers = tokenOffers(products);
    expect(offers.map((o) => o.productId)).toEqual(TOKEN_PACKS.map((p) => p.productId));
    expect(offers[0]).toMatchObject({ tokens: TOKEN_PACKS[0]!.tokens });
    expect(offers[0]!.price).toBe(`${String(TOKEN_PACKS.length - 1)},99 €`);
  });

  // Un pack que le store ne connait pas ne s'affiche pas : on ne vend pas ce
  // qu'on ne peut pas facturer.
  it('ecarte un pack sans produit dans le store, et un produit hors catalogue', () => {
    const offers = tokenOffers([
      { identifier: TOKEN_PACKS[1]!.productId, priceString: '4,99 €' },
      { identifier: 'aura.autre.chose', priceString: '1 €' },
    ]);
    expect(offers).toEqual([
      { productId: TOKEN_PACKS[1]!.productId, tokens: TOKEN_PACKS[1]!.tokens, price: '4,99 €' },
    ]);
  });
});

/*
  Apres le paiement, le telephone ne credite rien : le webhook le fait, un peu
  plus tard. Sans message, le joueur croirait a un echec et paierait deux fois.
*/
describe('noticeAfterWallet', () => {
  it('reste en attente tant que la bourse n a pas monte', () => {
    const pending = { kind: 'pending' as const, before: 11 };
    expect(noticeAfterWallet(pending, 11)).toBe(pending);
  });

  it('annonce les jetons recus des que la bourse monte', () => {
    expect(noticeAfterWallet({ kind: 'pending', before: 11 }, 111)).toEqual({
      kind: 'credited',
      tokens: 100,
    });
  });

  it('ne touche pas aux autres messages', () => {
    expect(noticeAfterWallet(null, 500)).toBeNull();
    expect(noticeAfterWallet({ kind: 'failed' }, 500)).toEqual({ kind: 'failed' });
  });
});
