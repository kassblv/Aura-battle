import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { dayIndexOf, featuredForDay } from '@aura/content';
import { describe, expect, it } from 'vitest';
import { ShopScreen } from './ShopScreen.js';
import type { TokenShop } from './useTokenStore.js';

const render = (tokenShop: TokenShop): string =>
  renderToStaticMarkup(
    createElement(ShopScreen, {
      state: { wallet: { soft: 100, hard: 5 }, owned: new Set<string>() },
      trying: null,
      onTry: () => undefined,
      onBuy: () => undefined,
      onClose: () => undefined,
      layout: { width: 480, columns: 2 },
      tokenShop,
    }),
  );

const shop = (over: Partial<TokenShop> = {}): TokenShop => ({
  status: 'ready',
  offers: [],
  buying: null,
  buy: () => undefined,
  ...over,
});

describe('ShopScreen — les packs de jetons', () => {
  it('dit sur le web que les jetons s achetent dans l application', () => {
    expect(render(shop({ status: 'web' }))).toContain('dans l’application');
  });

  it('montre chaque pack avec sa quantite et le prix du store', () => {
    const html = render(
      shop({ offers: [{ productId: 'aura.tokens.100', tokens: 100, price: '0,99 €' }] }),
    );
    expect(html).toMatch(/<button[^>]*class="shop__pack"/);
    expect(html).toContain('100');
    expect(html).toContain('0,99 €');
  });

  it('se tait quand le store n est pas disponible', () => {
    expect(render(shop({ status: 'none' }))).not.toContain('shop__packs');
  });
});

/*
  Une remise qu'on ne peut pas comparer n'est pas une remise : dans la barre
  d'achat d'un article en vitrine, chaque monnaie montre son prix plein barre.
*/
describe('ShopScreen — la vitrine', () => {
  it('barre le prix plein des deux monnaies dans la barre d achat', () => {
    const featured = featuredForDay(dayIndexOf(Date.now()))[0]!;
    const html = renderToStaticMarkup(
      createElement(ShopScreen, {
        state: { wallet: { soft: 0, hard: 0 }, owned: new Set<string>() },
        trying: featured,
        onTry: () => undefined,
        onBuy: () => undefined,
        onClose: () => undefined,
        layout: { width: 480, columns: 2 },
      }),
    );
    const bar = html.slice(html.indexOf('shop__buy'));
    expect(bar).toMatch(/data-currency="soft"[^>]*>.*<s class="shop__pay-was">\d+<\/s>/s);
    expect(bar).toMatch(/data-currency="hard"[^>]*>.*<s class="shop__pay-was">\d+<\/s>/s);
  });
});
