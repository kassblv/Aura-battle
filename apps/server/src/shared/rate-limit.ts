/**
 * Limite de debit par socket (docs/03-pvp-protocol.md), et par joueur sur les
 * routes HTTP qui coutent des requetes SQL (docs/06-anti-cheat.md).
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

export interface KeyedTokenBucketsOptions extends TokenBucketOptions {
  /**
   * Taille au-dela de laquelle on oublie les seaux pleins. Un seau plein vaut
   * un seau absent : le retirer ne change aucune decision future.
   */
  readonly sweepAbove?: number;
}

const DEFAULT_SWEEP_ABOVE = 10_000;

/**
 * Un seau a jetons par cle — par joueur, typiquement.
 *
 * La socket a son seau parce qu'elle a une duree de vie ; une route HTTP n'en
 * a pas, donc la cle doit etre l'identite, pas la connexion. Et des comptes
 * invites se creent a volonte : sans purge, la table grandirait sans fin. On
 * oublie donc les seaux PLEINS — sans perte, par construction — des qu'elle
 * depasse un seuil ; ne restent que les cles actives depuis quelques secondes.
 *
 * En memoire du processus : le jeu tourne dans un seul conteneur (ADR 0012).
 * Au multi-noeud, chaque noeud aurait sa limite — a porter dans Redis alors.
 */
export class KeyedTokenBuckets {
  private readonly buckets = new Map<string, TokenBucket>();
  private nextSweepAbove: number;

  constructor(private readonly options: KeyedTokenBucketsOptions) {
    this.nextSweepAbove = options.sweepAbove ?? DEFAULT_SWEEP_ABOVE;
  }

  /** Nombre de cles suivies. */
  get size(): number {
    return this.buckets.size;
  }

  tryConsume(key: string, atMs: number, cost = 1): boolean {
    let bucket = this.buckets.get(key);
    if (bucket === undefined) {
      bucket = new TokenBucket(this.options);
      this.buckets.set(key, bucket);
    }
    const allowed = bucket.tryConsume(atMs, cost);
    if (this.buckets.size > this.nextSweepAbove) this.sweep(atMs);
    return allowed;
  }

  private sweep(atMs: number): void {
    for (const [key, bucket] of this.buckets) {
      if (bucket.remaining(atMs) >= this.options.capacity) this.buckets.delete(key);
    }
    // Si la plupart des seaux sont entames, la purge suivante attend que la
    // table ait double : sans cela, chaque appel rebalaierait toute la table.
    this.nextSweepAbove = Math.max(
      this.options.sweepAbove ?? DEFAULT_SWEEP_ABOVE,
      2 * this.buckets.size,
    );
  }
}
