import { tokenPackFor } from '@aura/content';
import { z } from 'zod';

/**
 * Ce que le serveur fait d'un webhook de RevenueCat (ADR 0016), sans I/O.
 *
 * **La quantite vient du catalogue**, jamais de l'evenement : seul le produit
 * est lu, et `TOKEN_PACKS` dit combien il vaut. Un evenement ne porte pas de
 * montant qu'on croirait (regle d'or n°1 appliquee au paiement).
 *
 * Deux temps de lecture. D'abord le TYPE : tout ce qu'on ne traite pas
 * s'acquitte, quelle que soit la forme du reste — refuse en 400, un evenement
 * serait renvoye par RevenueCat jusqu'a epuisement. Ensuite seulement, pour un
 * achat ou un remboursement, le detail.
 */

const headSchema = z.object({
  event: z.object({ id: z.string().min(1).max(200), type: z.string().min(1).max(100) }),
});

/*
  Le detail laisse passer les champs qu'on ne lit pas, et accepte `null` :
  RevenueCat ajoute des champs d'une version a l'autre, et met a `null` ceux
  qui ne s'appliquent pas.
*/
const detailSchema = z.object({
  event: z.object({
    app_user_id: z.string().max(200).nullish(),
    product_id: z.string().max(200).nullish(),
    transaction_id: z.string().min(1).max(200),
    environment: z.string().max(50).nullish(),
    store: z.string().max(50).nullish(),
  }),
});

const playerIdSchema = z.uuid();

export type WebhookDecision =
  | {
      readonly kind: 'credit';
      readonly eventId: string;
      readonly transactionId: string;
      readonly playerId: string;
      readonly productId: string;
      readonly tokens: number;
      readonly store: string;
      readonly environment: string;
    }
  | {
      /** Un achat paye qu'on ne sait pas crediter : il s'inscrit pour le support. */
      readonly kind: 'unattributed';
      readonly reason: 'UNKNOWN_PRODUCT' | 'UNKNOWN_BUYER';
      readonly eventId: string;
      readonly transactionId: string;
      readonly appUserId: string;
      readonly productId: string;
      readonly store: string;
      readonly environment: string;
    }
  | {
      readonly kind: 'refund';
      readonly eventId: string;
      readonly transactionId: string;
      readonly store: string;
    }
  | { readonly kind: 'ignore'; readonly reason: 'TEST' | 'EVENT_TYPE' | 'SANDBOX' }
  | { readonly kind: 'invalid' };

export interface WebhookPolicy {
  /** Crediter les achats de test (`REVENUECAT_SANDBOX=1`, jamais en production). */
  readonly allowSandbox: boolean;
}

export function decideWebhook(body: unknown, policy: WebhookPolicy): WebhookDecision {
  const head = headSchema.safeParse(body);
  if (!head.success) return { kind: 'invalid' };
  const { id: eventId, type } = head.data.event;

  if (type === 'TEST') return { kind: 'ignore', reason: 'TEST' };
  if (type !== 'NON_RENEWING_PURCHASE' && type !== 'CANCELLATION') {
    return { kind: 'ignore', reason: 'EVENT_TYPE' };
  }

  // Sans transaction du store, pas d'anti-rejeu possible : on ne credite pas.
  const detail = detailSchema.safeParse(body);
  if (!detail.success) return { kind: 'invalid' };
  const event = detail.data.event;
  const store = event.store ?? 'UNKNOWN';
  const transactionId = event.transaction_id;

  // Le defaut sur est celui qui ne donne rien : sans environnement, un test.
  const environment = event.environment === 'PRODUCTION' ? 'PRODUCTION' : 'SANDBOX';
  if (environment !== 'PRODUCTION' && !policy.allowSandbox) {
    return { kind: 'ignore', reason: 'SANDBOX' };
  }

  if (type === 'CANCELLATION') return { kind: 'refund', eventId, transactionId, store };

  const productId = event.product_id ?? '';
  const appUserId = event.app_user_id ?? '';
  const unattributed = (reason: 'UNKNOWN_PRODUCT' | 'UNKNOWN_BUYER'): WebhookDecision => ({
    kind: 'unattributed',
    reason,
    eventId,
    transactionId,
    appUserId,
    productId,
    store,
    environment,
  });

  const pack = tokenPackFor(productId);
  if (pack === undefined) return unattributed('UNKNOWN_PRODUCT');
  // L'application configure RevenueCat avec l'identifiant du joueur : un
  // identifiant anonyme ne designe aucun compte a crediter.
  if (!playerIdSchema.safeParse(appUserId).success) return unattributed('UNKNOWN_BUYER');

  return {
    kind: 'credit',
    eventId,
    transactionId,
    playerId: appUserId,
    productId: pack.productId,
    tokens: pack.tokens,
    store,
    environment,
  };
}
