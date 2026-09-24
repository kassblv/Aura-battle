import { afterAll, describe, expect, it } from 'vitest';
import { DATABASE_TIMEOUTS } from './database-timeouts.js';
import { PrismaService } from './prisma.service.js';

/**
 * Test d'integration : un delai ecrit dans la configuration ne vaut que s'il
 * arrive jusqu'a la session Postgres. `pg` transmet `statement_timeout` et
 * `idle_in_transaction_session_timeout` comme parametres de demarrage ; on
 * demande a Postgres ce qu'il en a retenu.
 *
 * Meme convention que `auth/adapters/prisma-repositories.integration.test.ts`
 * (chargement du `.env`, garde-fou d'hote local, saut propre si la base est
 * injoignable).
 */

try {
  process.loadEnvFile(new URL('../../../../.env', import.meta.url));
} catch {
  // En CI les variables viennent de l'environnement.
}

const databaseUrl = process.env.DATABASE_URL ?? '';
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1', 'host.docker.internal']);

function isLocalDatabase(url: string): boolean {
  try {
    return LOCAL_HOSTS.has(new URL(url).hostname);
  } catch {
    return false;
  }
}

async function connect(): Promise<PrismaService | null> {
  if (databaseUrl === '' || !isLocalDatabase(databaseUrl)) return null;
  const client = new PrismaService({ databaseUrl, databasePoolMax: 2 });
  try {
    await client.$queryRaw`select 1`;
    return client;
  } catch {
    await client.$disconnect().catch(() => undefined);
    return null;
  }
}

const prisma = await connect();

afterAll(async () => {
  await prisma?.$disconnect();
});

/** Un reglage de la session, en millisecondes. */
async function setting(name: string): Promise<number> {
  const rows = await prisma!.$queryRawUnsafe<{ ms: number }[]>(
    `select setting::int as ms from pg_settings where name = $1`,
    name,
  );
  return rows[0]!.ms;
}

describe.skipIf(prisma === null)('PrismaService (integration)', () => {
  it('pose le delai d instruction sur la session', async () => {
    expect(await setting('statement_timeout')).toBe(DATABASE_TIMEOUTS.statementMs);
  });

  it('pose le delai de transaction muette sur la session', async () => {
    expect(await setting('idle_in_transaction_session_timeout')).toBe(
      DATABASE_TIMEOUTS.idleInTransactionMs,
    );
  });
});
