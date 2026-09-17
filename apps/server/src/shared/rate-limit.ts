/**
 * Limite de debit par socket (docs/03-pvp-protocol.md).
 *
 * Seau a jetons : chaque message en consomme un, le seau se remplit a debit
 * constant. Ce modele laisse passer les **rafales courtes** — un joueur envoie
 * ses taps par paquets, puis verrouille son choix — tout en bornant le debit
 * moyen. Une limite « N messages par seconde » stricte couperait le joueur
 * honnete au moment ou il joue le mieux.
 *
 * Le temps entre en parametre : aucun appel a l'horloge ici, donc l'expiration
 * et la recharge se testent sans attendre.
 */
export interface TokenBucketOptions {
  /** Nombre de jetons disponibles d'un coup. Borne la rafale. */
  readonly capacity: number;
  /** Jetons regagnes par seconde. Borne le debit moyen. */
  readonly refillPerSecond: number;
}

export class TokenBucket {
  private tokens: number;
  private lastRefillAtMs = 0;

  constructor(private readonly options: TokenBucketOptions) {
    this.tokens = options.capacity;
  }

  /** Recharge le seau jusqu'a l'instant donne, sans jamais depasser la capacite. */
  private refill(atMs: number): void {
    // Une horloge qui recule ne cree pas de jetons : sans cette borne, deux
    // messages horodates en desordre suffiraient a contourner la limite.
    const elapsedMs = Math.max(0, atMs - this.lastRefillAtMs);
    this.lastRefillAtMs = Math.max(this.lastRefillAtMs, atMs);
    this.tokens = Math.min(
      this.options.capacity,
      this.tokens + (elapsedMs / 1_000) * this.options.refillPerSecond,
    );
  }

  /** Consomme des jetons si le seau en contient assez. */
  tryConsume(atMs: number, cost = 1): boolean {
    this.refill(atMs);
    if (this.tokens < cost) {
      return false;
    }
    this.tokens -= cost;
    return true;
  }

  /** Jetons restants a cet instant, arrondis vers le bas. */
  remaining(atMs: number): number {
    this.refill(atMs);
    return Math.floor(this.tokens);
  }
}
