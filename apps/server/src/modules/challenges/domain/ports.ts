import type { MatchContribution, StoredProgress } from './progress.js';

/**
 * Ports des defis quotidiens (architecture hexagonale, docs/02).
 *
 * Le service ne connait ni Prisma ni l'horloge : il les recoit. C'est ce qui
 * permet de tester une course entre deux encaissements sans base de donnees.
 */

export interface ChallengeRepository {
  /** Progression du jour. Une ligne n'existe que si le joueur a avance. */
  read(playerId: string, day: number): Promise<readonly StoredProgress[]>;

  /**
   * Ecrit la progression de plusieurs defis, **en un seul appel**.
   *
   * Un appel par defi ferait trois aller-retours a chaque fin de match, et
   * surtout trois transactions la ou une seule decrit le meme fait.
   */
  write(
    playerId: string,
    day: number,
    entries: readonly { readonly challengeId: string; readonly progress: number }[],
  ): Promise<void>;

  /**
   * Marque le defi encaisse **et** credite la bourse, en une transaction.
   *
   * Rend `false` si quelqu'un l'a deja encaisse. La garde ne peut pas vivre
   * dans le service : entre sa lecture et son ecriture, un second onglet a
   * le temps de passer — et la recompense serait payee deux fois. C'est la
   * base qui tranche, par une mise a jour conditionnee a `claimedAt IS NULL`.
   */
  claim(playerId: string, day: number, challengeId: string, reward: number): Promise<boolean>;
}

/** L'horloge est un port : le temps est une entree, pas une globale. */
export interface Clock {
  now(): Date;
}

/**
 * Ce que le module `match` attend des defis.
 *
 * Un port etroit, et il va dans un seul sens : le match REMET un total de
 * mesures deja faites. Les defis ne savent rien d'une manche, d'un siege ni
 * d'un amplificateur — et le match n'a aucune raison de savoir quels defis
 * couraient ce jour-la.
 */
export interface ChallengeTracker {
  recordMatch(playerId: string, contribution: MatchContribution): Promise<void>;
}
