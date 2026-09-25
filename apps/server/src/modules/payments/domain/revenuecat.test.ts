import { TOKEN_PACKS } from '@aura/content';
import { describe, expect, it } from 'vitest';
import { decideWebhook } from './revenuecat.js';

const PLAYER = '811fa70a-c2cc-4f2e-832e-b1c662c7bd31';
const PACK = TOKEN_PACKS[0]!;
const STRICT = { allowSandbox: false };

const body = (event: Record<string, unknown> = {}) => ({
  api_version: '1.0',
  event: {
    id: 'evt-1',
    type: 'NON_RENEWING_PURCHASE',
    app_user_id: PLAYER,
    product_id: PACK.productId,
    transaction_id: 'tx-1',
    environment: 'PRODUCTION',
    store: 'APP_STORE',
    ...event,
  },
});

describe('decideWebhook — credit', () => {
  it('credite le pack achete, d apres le catalogue et jamais d apres l evenement', () => {
    expect(decideWebhook(body({ tokens: 99_999 }), STRICT)).toEqual({
      kind: 'credit',
      eventId: 'evt-1',
      transactionId: 'tx-1',
      playerId: PLAYER,
      productId: PACK.productId,
      tokens: PACK.tokens,
      store: 'APP_STORE',
      environment: 'PRODUCTION',
    });
  });

  // Sans transaction du store, pas d'anti-rejeu : on ne credite pas.
  it('refuse un achat sans identifiant de transaction', () => {
    expect(decideWebhook(body({ transaction_id: null }), STRICT)).toEqual({ kind: 'invalid' });
  });
});

describe('decideWebhook — ce qui s acquitte sans crediter', () => {
  it('refuse un corps qui n est pas un evenement', () => {
    expect(decideWebhook({ hello: 'world' }, STRICT)).toEqual({ kind: 'invalid' });
    expect(decideWebhook(null, STRICT)).toEqual({ kind: 'invalid' });
  });

  it('accuse reception du bouton de test du tableau de bord', () => {
    expect(decideWebhook(body({ type: 'TEST' }), STRICT)).toEqual({
      kind: 'ignore',
      reason: 'TEST',
    });
  });

  /*
    Un type qu'on ne traite pas s'acquitte AVANT toute autre validation : un
    TRANSFER sans `app_user_id`, ou des champs a `null`, refuses en 400,
    seraient renvoyes par RevenueCat jusqu'a epuisement.
  */
  it('ignore un type non traite, quelle que soit la forme du reste', () => {
    expect(
      decideWebhook(
        { event: { id: 'evt-2', type: 'TRANSFER', transferred_from: ['a'], product_id: null } },
        STRICT,
      ),
    ).toEqual({ kind: 'ignore', reason: 'EVENT_TYPE' });
  });

  it('accepte des champs facultatifs a null', () => {
    expect(decideWebhook(body({ store: null }), STRICT)).toMatchObject({
      kind: 'credit',
      store: 'UNKNOWN',
    });
  });

  // Un achat de test credite en production serait un jeton gratuit pour tout testeur.
  it('ignore un achat de test tant que le sandbox n est pas permis', () => {
    expect(decideWebhook(body({ environment: 'SANDBOX' }), STRICT)).toEqual({
      kind: 'ignore',
      reason: 'SANDBOX',
    });
    expect(decideWebhook(body({ environment: 'SANDBOX' }), { allowSandbox: true }).kind).toBe(
      'credit',
    );
  });

  // Le defaut sur doit etre celui qui ne donne rien.
  it('traite un environnement absent comme un achat de test', () => {
    expect(decideWebhook(body({ environment: null }), STRICT)).toEqual({
      kind: 'ignore',
      reason: 'SANDBOX',
    });
  });
});

/*
  Un achat PAYE qu'on ne sait pas attribuer ne disparait pas en silence : il
  s'inscrit, pour que le support le retrouve et le rende.
*/
describe('decideWebhook — achats a attribuer a la main', () => {
  it('inscrit un produit qui n est pas un pack de jetons', () => {
    expect(decideWebhook(body({ product_id: 'aura.inconnu' }), STRICT)).toEqual({
      kind: 'unattributed',
      reason: 'UNKNOWN_PRODUCT',
      eventId: 'evt-1',
      transactionId: 'tx-1',
      appUserId: PLAYER,
      productId: 'aura.inconnu',
      store: 'APP_STORE',
      environment: 'PRODUCTION',
    });
  });

  it('inscrit un acheteur qui n est pas un de nos joueurs', () => {
    expect(decideWebhook(body({ app_user_id: '$RCAnonymousID:abc' }), STRICT)).toMatchObject({
      kind: 'unattributed',
      reason: 'UNKNOWN_BUYER',
      appUserId: '$RCAnonymousID:abc',
    });
  });
});

describe('decideWebhook — remboursement', () => {
  it('vise la transaction remboursee', () => {
    expect(decideWebhook(body({ type: 'CANCELLATION', id: 'evt-9' }), STRICT)).toEqual({
      kind: 'refund',
      eventId: 'evt-9',
      transactionId: 'tx-1',
      store: 'APP_STORE',
    });
  });
});
