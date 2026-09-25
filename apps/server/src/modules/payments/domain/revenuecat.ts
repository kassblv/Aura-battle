import { tokenPackFor } from '@aura/content';
import { z } from 'zod';

/**
 * Ce que le serveur fait d'un webhook de RevenueCat (ADR 0016), sans I/O.
 *
 * **La quantite vient du catalogue**, jamais de l'evenement : seul le produit
 * est lu, et `TOKEN_PACKS` dit combien il vaut. Un evenement ne porte pas de
 * montant qu'on croirait (regle d'or n°1 appliquee au paiement).
 *
 * Seul un achat de consommable (`NON_RENEWING_PURCHASE`) credite. Tout le
 * reste est acquitte sans effet : RevenueCat renvoie un webhook tant qu'il
 * n'a pas recu de 2xx, et un refus pour un evenement qu'on ne traite pas le
 * ferait renvoyer indefiniment.
 */

/*
  Le schema ne retient que ce qui sert, et laisse passer le reste : RevenueCat
  ajoute des champs d'une version a l'autre, et un schema ferme refuserait un
  achat reel le jour ou il en ajoute un.
*/
const eventSchema = z.object({
  event: z.object({
    id: z.string().min(1).max(200),
    type: z.string().min(1).max(100),
    app_user_id: z.string().min(1).max(200),
    product_id: z.string().max(200).optional(),
    environment: z.string().max(50).optional(),
    store: z.string().max(50).optional(),
  }),
});

const playerIdSchema = z.uuid();

export type WebhookDecision =
  | {
      readonly kind: 'credit';
      readonly eventId: string;
      readonly playerId: string;
      readonly productId: string;
      readonly tokens: number;
      readonly store: string;
      readonly environment: string;
    }
  | {
      readonly kind: 'refund';
      readonly eventId: string;
      readonly playerId: string;
      readonly productId: string;
    }
  | {
      readonly kind: 'ignore';
      readonly reason: 'TEST' | 'EVENT_TYPE' | 'SANDBOX' | 'UNKNOWN_PRODUCT' | 'UNKNOWN_BUYER';
    }
  | { readonly kind: 'invalid' };

export interface WebhookPolicy {
  /** Crediter les achats de test (`REVENUECAT_SANDBOX=1`). */
  readonly allowSandbox: boolean;
}

export function decideWebhook(body: unknown, policy: WebhookPolicy): WebhookDecision {
  const parsed = eventSchema.safeParse(body);
  if (!parsed.success) return { kind: 'invalid' };
  const event = parsed.data.event;

  if (event.type === 'TEST') return { kind: 'ignore', reason: 'TEST' };
  if (event.type !== 'NON_RENEWING_PURCHASE' && event.type !== 'CANCELLATION') {
    return { kind: 'ignore', reason: 'EVENT_TYPE' };
  }

  const environment = event.environment ?? 'PRODUCTION';
  if (environment !== 'PRODUCTION' && !policy.allowSandbox) {
    return { kind: 'ignore', reason: 'SANDBOX' };
  }

  const pack = tokenPackFor(event.product_id ?? '');
  if (pack === undefined) return { kind: 'ignore', reason: 'UNKNOWN_PRODUCT' };

  // L'application configure RevenueCat avec l'identifiant du joueur : un
  // identifiant anonyme ne designe aucun compte a crediter.
  if (!playerIdSchema.safeParse(event.app_user_id).success) {
    return { kind: 'ignore', reason: 'UNKNOWN_BUYER' };
  }

  if (event.type === 'CANCELLATION') {
    return {
      kind: 'refund',
      eventId: event.id,
      playerId: event.app_user_id,
      productId: pack.productId,
    };
  }

  return {
    kind: 'credit',
    eventId: event.id,
    playerId: event.app_user_id,
    productId: pack.productId,
    tokens: pack.tokens,
    store: event.store ?? 'UNKNOWN',
    environment,
  };
}
