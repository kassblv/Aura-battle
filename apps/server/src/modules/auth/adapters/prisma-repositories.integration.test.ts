import { randomUUID } from 'node:crypto';
import { Writable } from 'node:stream';
import { PrismaPg } from '@prisma/adapter-pg';
import { Prisma, PrismaClient } from '@prisma/client';
import { afterAll, describe, expect, it } from 'vitest';
import { loadConfig } from '../../../shared/config.js';
import { createLogger, PinoLoggerService } from '../../../shared/logger.js';
import { DeviceIdentityConflictError } from '../domain/ports.js';
import { PrismaPlayerRepository } from './prisma-repositories.js';

/**
 * Test d'integration : c'est la **contrainte d'unicite de Postgres** qui doit
 * produire `P2002`, pas un double qui le recite.
 *
 * Le test unitaire voisin prouve le branchement de l'adaptateur en lui tendant
 * une erreur `P2002` toute faite. Il ne prouve pas que deux insertions du meme
 * `deviceHash` produisent ce code-la : un faux Prisma ne demontre que le faux.
 * Or toute la correction de course repose dessus — si la base repondait
 * `P2003`, ou si la contrainte disparaissait d'une migration, la chaine
 * casserait sans qu'aucun test unitaire ne bouge.
 *
 * Meme convention que `modules/match/adapters/prisma-match.integration.test.ts`
 * (chargement du `.env`, garde-fou d'hote local, saut propre si la base est
 * injoignable), a laquelle on se refere pour les tests du garde-fou lui-meme.
 */

try {
  process.loadEnvFile(new URL('../../../../../../.env', import.meta.url));
} catch {
  // En CI les variables viennent de l'environnement.
}

const databaseUrl = process.env.DATABASE_URL ?? '';

/**
 * Ce test **ecrit et supprime** des lignes : il ne doit jamais viser autre
 * chose qu'une base locale. Un `.env` de preprod oublie suffirait a le faire
 * « marcher » sur de vraies donnees.
 */
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1', 'host.docker.internal']);

function isLocalDatabase(url: string): boolean {
  try {
    return LOCAL_HOSTS.has(new URL(url).hostname);
  } catch {
    return false;
  }
}

/**
 * La joignabilite se decide **au chargement du module** : `describe.skipIf` est
 * evalue a la collecte, donc avant tout `beforeAll`.
 */
async function connect(): Promise<PrismaClient | null> {
  if (databaseUrl === '' || !isLocalDatabase(databaseUrl)) return null;
  try {
    const client = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl }) });
    await client.$queryRaw`select 1`;
    return client;
  } catch {
    return null;
  }
}

const prisma = await connect();
const reachable = prisma !== null;

/**
 * Identites creees par les tests, effacees a la fin **quoi qu'il arrive**.
 *
 * Un nettoyage pose en derniere ligne d'un test est saute des que ce test
 * echoue : c'est exactement le moment ou l'on relance, et une base qui garde
 * les restes de l'essai precedent fait echouer le suivant pour une raison qui
 * n'a plus rien a voir avec le code.
 */
const created = new Set<string>();

afterAll(async () => {
  if (prisma !== null && created.size > 0) {
    await prisma.player.deleteMany({
      where: {
        identities: { some: { provider: 'DEVICE', subject: { in: [...created] } } },
      },
    });
  }
  await prisma?.$disconnect();
});

function buildRepository(): PrismaPlayerRepository {
  return new PrismaPlayerRepository(prisma as never);
}

/** Une identite d'appareil jamais vue, effacee a la fin de la suite. */
function newDeviceHash(): string {
  const deviceHash = `test_${randomUUID()}`;
  created.add(deviceHash);
  return deviceHash;
}

/** Capture les lignes ecrites par le logger, comme dans `shared/logger.test.ts`. */
function capture(): { lines: string[]; stream: Writable } {
  const lines: string[] = [];
  const stream = new Writable({
    write(chunk: Buffer, _encoding, callback) {
      lines.push(chunk.toString());
      callback();
    },
  });
  return { lines, stream };
}

describe.skipIf(!reachable)('contrainte d unicite de l identite d appareil', () => {
  it('traduit la collision reelle des deux ouvertures de session en conflit de domaine', async () => {
    // Deux onglets, un double appui, un reessai reseau : les deux appels ne
    // trouvent rien et creent en meme temps. C'est Postgres qui arbitre.
    const deviceHash = newDeviceHash();
    // Nom unique au test : la base de developpement est partagee, et compter
    // les « Aura Perdante » du monde entier dirait autre chose que ce qu'on
    // veut savoir.
    const loserName = `Aura Perdante ${deviceHash}`;
    const players = buildRepository();

    const winner = await players.createWithDeviceIdentity({
      deviceHash,
      displayName: 'Aura Gagnante',
    });

    const thrown = await players
      .createWithDeviceIdentity({ deviceHash, displayName: loserName })
      .catch((error: unknown) => error);

    expect(thrown).toBeInstanceOf(DeviceIdentityConflictError);

    // La cause vient bien de la contrainte `(provider, subject)` : c'est ce
    // maillon-la — le code d'erreur reel de la base — que le test unitaire ne
    // peut pas verifier.
    const cause = (thrown as Error).cause;
    expect(cause).toBeInstanceOf(Prisma.PrismaClientKnownRequestError);
    expect((cause as Prisma.PrismaClientKnownRequestError).code).toBe('P2002');
    expect(JSON.stringify((cause as Prisma.PrismaClientKnownRequestError).meta)).toContain(
      'AuthIdentity',
    );

    // Le perdant ne laisse rien derriere lui : ni identite en double, ni joueur
    // orphelin. La creation imbriquee est atomique, et seule une vraie base
    // peut le montrer.
    expect(
      await prisma!.authIdentity.count({ where: { provider: 'DEVICE', subject: deviceHash } }),
    ).toBe(1);
    expect(await prisma!.player.count({ where: { displayName: loserName } })).toBe(0);

    // Et le perdant retrouve bien le joueur du gagnant : la chaine complete de
    // l'adoption, de la contrainte jusqu'au cas d'usage.
    expect(await players.findByDeviceHash(deviceHash)).toEqual(winner);
  });

  it('ne laisse pas fuir le deviceHash dans un journal, ni par l erreur ni par sa cause', async () => {
    // L'erreur du domaine transporte la cause Prisma. Si cette cause citait la
    // valeur en conflit — Postgres, lui, la met dans son `DETAIL` —, une seule
    // ligne de journal suffirait a publier l'identifiant d'appareil d'un
    // joueur, c'est-a-dire ce qui distingue son telephone de tous les autres.
    // Deux protections doivent tenir, et ce test les verifie separement.
    const deviceHash = newDeviceHash();
    const players = buildRepository();
    await players.createWithDeviceIdentity({ deviceHash, displayName: 'Aura Gagnante' });

    const thrown = (await players
      .createWithDeviceIdentity({ deviceHash, displayName: 'Aura Perdante' })
      .catch((error: unknown) => error)) as Error;
    const cause = thrown.cause as Prisma.PrismaClientKnownRequestError;

    // 1. Prisma ne recopie pas la valeur refusee : il nomme la contrainte, la
    //    table et le modele, jamais le `subject`. Si une version future se
    //    mettait a recopier le `DETAIL` de Postgres, ce test vire au rouge
    //    avant que le journal ne le fasse en production.
    const brut = JSON.stringify({
      message: cause.message,
      stack: cause.stack,
      meta: cause.meta,
    });
    expect(brut).not.toContain(deviceHash);

    // 2. L'adaptateur de journalisation ne suit pas la chaine des causes : il
    //    ecrit `name`, `message` et `stack`, rien d'autre. Meme une cause
    //    bavarde resterait donc hors du journal.
    const { lines, stream } = capture();
    const logger = new PinoLoggerService(
      createLogger(
        loadConfig({
          DATABASE_URL: databaseUrl,
          REDIS_URL: 'redis://localhost:6379',
          JWT_SECRET: 'un-secret-assez-long',
          NODE_ENV: 'test',
        }),
        stream,
      ),
    );
    logger.error(thrown);
    logger.error(cause);

    const sortie = lines.join('');
    expect(sortie).not.toContain(deviceHash);
    // Le journal reste utile malgre tout : l'erreur n'a pas disparu.
    expect(sortie).toContain('DEVICE_IDENTITY_CONFLICT');
  });
});

describe.skipIf(reachable)('base indisponible', () => {
  it('signale pourquoi le test d integration a ete saute', () => {
    // Un saut silencieux laisse croire a une couverture qui n'existe pas.
    console.warn(
      "[integration] base injoignable ou non locale sur DATABASE_URL — lancez `docker compose up -d` pour executer les tests d'identite d'appareil",
    );
    expect(reachable).toBe(false);
  });
});

describe.skipIf(!reachable)('code de recuperation, contre une vraie base', () => {
  /*
    C'est Postgres qui doit remplacer l'ancien code, pas un double qui le
    recite. `setRecoveryIdentity` fait une suppression PUIS une creation dans
    une transaction, parce que la contrainte d'unicite porte sur
    `(provider, subject)` et non sur `(provider, playerId)` : il n'existe
    aucune cle sur laquelle poser un `upsert`. Si cette transaction ne tenait
    pas, un joueur se retrouverait avec deux codes vivants — ou aucun.
  */
  it('retrouve le joueur par son code', async () => {
    const repository = buildRepository();
    const player = await repository.createWithDeviceIdentity({
      deviceHash: newDeviceHash(),
      displayName: 'Testeuse',
    });

    await repository.setRecoveryIdentity(player.id, 'hash_recovery_un');
    await expect(repository.findByRecoveryHash('hash_recovery_un')).resolves.toEqual(player);
  });

  it('remplace le code precedent plutot que de l ajouter', async () => {
    const repository = buildRepository();
    const player = await repository.createWithDeviceIdentity({
      deviceHash: newDeviceHash(),
      displayName: 'Testeur',
    });

    await repository.setRecoveryIdentity(player.id, 'hash_recovery_ancien');
    await repository.setRecoveryIdentity(player.id, 'hash_recovery_nouveau');

    await expect(repository.findByRecoveryHash('hash_recovery_nouveau')).resolves.toEqual(player);
    // L'ancien n'ouvre plus rien : c'est ce qui rend un code revocable.
    await expect(repository.findByRecoveryHash('hash_recovery_ancien')).resolves.toBeNull();

    const identities = await (prisma!).authIdentity.count({
      where: { playerId: player.id, provider: 'RECOVERY' },
    });
    expect(identities).toBe(1);
  });

  it('ne touche pas a l identite d appareil', async () => {
    const repository = buildRepository();
    const deviceHash = newDeviceHash();
    const player = await repository.createWithDeviceIdentity({
      deviceHash,
      displayName: 'Intacte',
    });

    await repository.setRecoveryIdentity(player.id, 'hash_recovery_autre');
    // Le compte invite continue de s'ouvrir depuis le navigateur d'origine :
    // lier un compte AJOUTE une ligne, sans rien deplacer (docs/04).
    await expect(repository.findByDeviceHash(deviceHash)).resolves.toEqual(player);
  });
});
