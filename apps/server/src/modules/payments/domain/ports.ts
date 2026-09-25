/** Un credit de jetons payes, tel que le webhook l'a decide. */
export interface TokenCredit {
  readonly eventId: string;
  readonly playerId: string;
  readonly productId: string;
  readonly tokens: number;
  readonly store: string;
  readonly environment: string;
}

/**
 * - `granted` : credite, pour la premiere fois ;
 * - `duplicate` : cet evenement l'a deja ete — un renvoi de RevenueCat ;
 * - `unknown_player` : aucun joueur de cet identifiant.
 */
export type GrantOutcome = 'granted' | 'duplicate' | 'unknown_player';

export interface TokenLedger {
  grant(credit: TokenCredit): Promise<GrantOutcome>;
}

export const TOKEN_LEDGER = Symbol('TOKEN_LEDGER');
