import { describe, expect, it } from 'vitest';
import {
  CREDIT_TRANSACTION,
  DATABASE_TIMEOUTS,
  PURCHASE_TRANSACTION,
  WORST_QUERY_MS,
} from './database-timeouts.js';

/**
 * Les delais de la base ne valent que les uns par rapport aux autres : ce sont
 * ces relations qu'on fige ici, pas les nombres.
 */
describe('DATABASE_TIMEOUTS', () => {
  it('laisse Postgres couper une instruction avant que le client ne l abandonne', () => {
    // Coupee par le serveur, l'instruction rend une erreur propre et la
    // connexion reste saine ; le delai du client ne sert qu'a la base muette.
    expect(DATABASE_TIMEOUTS.statementMs).toBeLessThan(DATABASE_TIMEOUTS.queryMs);
  });

  it('ne coupe aucune transaction interactive encore dans ses delais', () => {
    // Celle du match est verifiee a cote d'elle (`prisma-match.repository.test.ts`).
    expect(DATABASE_TIMEOUTS.idleInTransactionMs).toBeGreaterThan(PURCHASE_TRANSACTION.timeout);
    expect(DATABASE_TIMEOUTS.idleInTransactionMs).toBeGreaterThan(CREDIT_TRANSACTION.timeout);
  });

  /*
    Le credit de fin de match (pieces, experience, jetons) attend une connexion
    aussi longtemps que l'enregistrement du match qui le precede : sous charge,
    abandonner le credit plus tot que le match ferait perdre au joueur ce que
    le match vient de lui donner.
  */
  it('laisse au credit de fin de match le temps d attendre une connexion', () => {
    expect(CREDIT_TRANSACTION.maxWait).toBeGreaterThanOrEqual(DATABASE_TIMEOUTS.connectMs);
    expect(DATABASE_TIMEOUTS.statementMs).toBeGreaterThanOrEqual(CREDIT_TRANSACTION.timeout);
  });

  it('ne coupe pas une instruction plus tot que la transaction qui la porte', () => {
    expect(DATABASE_TIMEOUTS.statementMs).toBeGreaterThanOrEqual(PURCHASE_TRANSACTION.timeout);
  });

  it('borne toute requete hors transaction', () => {
    expect(WORST_QUERY_MS).toBe(DATABASE_TIMEOUTS.connectMs + DATABASE_TIMEOUTS.queryMs);
    for (const value of Object.values(DATABASE_TIMEOUTS)) {
      expect(Number.isInteger(value) && value > 0).toBe(true);
    }
  });
});
