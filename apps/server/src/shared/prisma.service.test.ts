import { describe, expect, it } from 'vitest';
import { DATABASE_TIMEOUTS } from './database-timeouts.js';
import { databasePoolConfig } from './prisma.service.js';

describe('databasePoolConfig', () => {
  const pool = databasePoolConfig({
    databaseUrl: 'postgresql://aura:aura@localhost:5433/aura',
    databasePoolMax: 7,
  });

  it('garde l URL et la taille choisie du bassin', () => {
    expect(pool.connectionString).toBe('postgresql://aura:aura@localhost:5433/aura');
    expect(pool.max).toBe(7);
  });

  /*
    Sans eux, `pg` attend indefiniment : une connexion (`connectionTimeoutMillis`
    vaut 0) comme une reponse. Une coupure reseau silencieuse vers Postgres
    laissait alors pendre l'achat d'un joueur, et avec lui toute sa file.
  */
  it('borne l attente d une connexion, d une instruction et d une reponse', () => {
    expect(pool.connectionTimeoutMillis).toBe(DATABASE_TIMEOUTS.connectMs);
    expect(pool.statement_timeout).toBe(DATABASE_TIMEOUTS.statementMs);
    expect(pool.query_timeout).toBe(DATABASE_TIMEOUTS.queryMs);
    expect(pool.idle_in_transaction_session_timeout).toBe(DATABASE_TIMEOUTS.idleInTransactionMs);
  });
});
