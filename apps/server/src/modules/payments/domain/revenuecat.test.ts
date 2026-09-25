import { TOKEN_PACKS } from '@aura/content';
import { describe, expect, it } from 'vitest';
import { decideWebhook } from './revenuecat.js';

const PLAYER = '811fa70a-c2cc-4f2e-832e-b1c662c7bd31';
const PACK = TOKEN_PACKS[0]!;

const body = (event: Record<string, unknown> = {}) => ({
  api_version: '1.0',
  event: {
    id: 'evt-1',
    type: 'NON_RENEWING_PURCHASE',
    app_user_id: PLAYER,
    product_id: PACK.productId,
    environment: 'PRODUCTION',
    store: 'APP_STORE',
    ...event,
  },
});

describe('decideWebhook', () => {
  it('credite le pack achete, d apres le catalogue et jamais d apres l evenement', () => {
    expect(decideWebhook(body({ tokens: 99_999 }), { allowSandbox: false })).toEqual({
      kind: 'credit',
      eventId: 'evt-1',
      playerId: PLAYER,
      productId: PACK.productId,
      tokens: PACK.tokens,
      store: 'APP_STORE',
      environment: 'PRODUCTION',
    });
  });

  it('refuse un corps qui n est pas un evenement', () => {
    expect(decideWebhook({ hello: 'world' }, { allowSandbox: false })).toEqual({ kind: 'invalid' });
    expect(decideWebhook(null, { allowSandbox: false })).toEqual({ kind: 'invalid' });
  });

  it('accuse reception du bouton de test du tableau de bord sans crediter', () => {
    expect(decideWebhook(body({ type: 'TEST' }), { allowSandbox: false })).toEqual({
      kind: 'ignore',
      reason: 'TEST',
    });
  });

  it('ignore les autres types d evenement', () => {
    expect(decideWebhook(body({ type: 'INITIAL_PURCHASE' }), { allowSandbox: false })).toEqual({
      kind: 'ignore',
      reason: 'EVENT_TYPE',
    });
  });

  // Un achat de test credite en production serait un jeton gratuit pour tout testeur.
  it('ignore un achat de test tant que le sandbox n est pas permis', () => {
    expect(decideWebhook(body({ environment: 'SANDBOX' }), { allowSandbox: false })).toEqual({
      kind: 'ignore',
      reason: 'SANDBOX',
    });
    expect(decideWebhook(body({ environment: 'SANDBOX' }), { allowSandbox: true }).kind).toBe(
      'credit',
    );
  });

  it('ignore un produit qui n est pas un pack de jetons', () => {
    expect(decideWebhook(body({ product_id: 'aura.inconnu' }), { allowSandbox: false })).toEqual({
      kind: 'ignore',
      reason: 'UNKNOWN_PRODUCT',
    });
  });

  // Un identifiant anonyme de RevenueCat ne designe aucun de nos joueurs.
  it('ignore un acheteur qui n est pas un de nos joueurs', () => {
    expect(
      decideWebhook(body({ app_user_id: '$RCAnonymousID:abc' }), { allowSandbox: false }),
    ).toEqual({ kind: 'ignore', reason: 'UNKNOWN_BUYER' });
  });

  /*
    Un remboursement ne se debite pas automatiquement : il se signale. Les
    jetons ont pu etre depenses, et un solde negatif n'existe pas.
  */
  it('signale un remboursement sans rien debiter', () => {
    expect(decideWebhook(body({ type: 'CANCELLATION' }), { allowSandbox: false })).toEqual({
      kind: 'refund',
      eventId: 'evt-1',
      playerId: PLAYER,
      productId: PACK.productId,
    });
  });
});
