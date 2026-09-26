import type { ClaimKey, ClaimRefusal, PremiumRefusal, SeasonGrant } from './claim.js';

/**
 * Ports du passe de saison (architecture hexagonale, docs/02).
 *
 * Le service ne connait ni Prisma ni l'horloge : il les recoit. C'est ce qui
 * permet de verifier une double reclamation sans base de donnees.
 */

/** La saison en cours, telle que le passe la montre. */
export interface CurrentSeason {
  readonly id: string;
  readonly number: number;
  readonly endsAt: Date;
}

/** Le passe d'un joueur pour une saison. Sans ligne : zero XP, rien de reclame. */
export interface SeasonProgress {
  readonly xp: number;
  readonly premium: boolean;
  readonly claimed: readonly ClaimKey[];
}

/** Les refus qu'une ecriture seule peut trancher : un autre appel est passe avant. */
export type SeasonWriteRefusal = 'ALREADY_CLAIMED' | PremiumRefusal;

/**
 * Leve par le depot quand la base refuse l'ecriture, avec SA raison.
 *
 * Un refus, pas une panne : l'appelant le traduit en reponse au joueur. Toute
 * autre erreur est une panne, et remonte telle quelle.
 */
export class SeasonConflictError extends Error {
  constructor(
    readonly reason: SeasonWriteRefusal,
    cause?: unknown,
  ) {
    super('SEASON_CONFLICT', { cause });
    this.name = 'SeasonConflictError';
  }
}

export interface SeasonRepository {
  /** La saison qui encadre `nowMs` (`currentSeason`), ou `null`. */
  current(nowMs: number): Promise<CurrentSeason | null>;
  progress(playerId: string, seasonId: string): Promise<SeasonProgress>;
  /**
   * Inscrit les reclamations PUIS credite, **en une transaction**.
   *
   * La cle primaire de `SeasonClaim` tranche la double reclamation : deux
   * onglets, et le second rejette avec `SeasonConflictError('ALREADY_CLAIMED')`
   * sans rien crediter. Un cosmetique que la base trouve deja possede (un
   * achat entre la lecture et l'ecriture) devient ses `fallbackCoins`.
   */
  grant(playerId: string, seasonId: string, grants: readonly SeasonGrant[]): Promise<void>;
  /**
   * Ouvre la piste premium et debite `price` jetons, en une transaction.
   *
   * Deux gardes conditionnelles : `premiumAt` encore nul (`ALREADY_PREMIUM`),
   * et une bourse qui couvre le prix (`INSUFFICIENT_FUNDS`). L'une ou l'autre
   * refusee, rien n'est ecrit.
   */
  buyPremium(playerId: string, seasonId: string, price: number): Promise<void>;
}

/** Tous les refus du passe, tels que le controleur les traduit. */
export type SeasonFailure = ClaimRefusal | PremiumRefusal | 'NO_SEASON';

/** L'horloge est un port : le temps est une entree, pas une globale. */
export interface Clock {
  now(): Date;
}
