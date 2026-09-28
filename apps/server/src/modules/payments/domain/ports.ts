/** Un credit de jetons payes, tel que le webhook l'a decide. */
export interface TokenCredit {
  readonly eventId: string;
  readonly transactionId: string;
  readonly playerId: string;
  readonly productId: string;
  readonly tokens: number;
  readonly store: string;
  readonly environment: string;
}

/** Un achat paye qu'on ne sait pas crediter : il s'inscrit pour le support. */
export interface UnattributedPurchase {
  readonly eventId: string;
  readonly transactionId: string;
  readonly reason: 'UNKNOWN_PRODUCT' | 'UNKNOWN_BUYER' | 'UNKNOWN_PLAYER';
  readonly appUserId: string;
  readonly productId: string;
  readonly store: string;
  readonly environment: string;
}

export interface TokenRefund {
  readonly eventId: string;
  readonly transactionId: string;
  readonly store: string;
}

/**
 * - `granted` : credite, pour la premiere fois ;
 * - `duplicate` : cet evenement, ou cette transaction du store, l'a deja ete ;
 * - `unattributed` : aucun joueur de cet identifiant — inscrit pour le support.
 */
export type GrantOutcome = 'granted' | 'duplicate' | 'unattributed';

export type RefundOutcome =
  /** `taken` jetons repris ; `owed` deja depenses, que la bourse ne couvrait plus. */
  | { readonly kind: 'refunded'; readonly taken: number; readonly owed: number }
  | { readonly kind: 'already' }
  | { readonly kind: 'unknown' };

export interface TokenLedger {
  grant(credit: TokenCredit): Promise<GrantOutcome>;
  recordUnattributed(purchase: UnattributedPurchase): Promise<'recorded' | 'duplicate'>;
  refund(refund: TokenRefund): Promise<RefundOutcome>;
}

export const TOKEN_LEDGER = Symbol('TOKEN_LEDGER');
