import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';

/**
 * Client Prisma des tests d'integration, ou `null`.
 *
 * Meme garde que les tests d'integration existants : la base doit etre
 * joignable ET locale — un `DATABASE_URL` de production laisse dans un
 * terminal ne doit jamais recevoir les ecritures d'un test. Aucun fichier
 * `.env` n'est lu ici : l'URL vient de l'environnement du lanceur.
 */
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1', 'host.docker.internal']);

export async function connectLocalPrisma(): Promise<PrismaClient | null> {
  const url = process.env.DATABASE_URL ?? '';
  try {
    if (url === '' || !LOCAL_HOSTS.has(new URL(url).hostname)) return null;
  } catch {
    return null;
  }
  try {
    const client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
    await client.$queryRaw`select 1`;
    return client;
  } catch {
    return null;
  }
}
