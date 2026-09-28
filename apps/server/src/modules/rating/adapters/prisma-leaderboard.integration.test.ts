import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaRatingRepository } from './prisma-rating.repository.js';

/**
 * Test d'integration : c'est le SQL qui doit tenir le rang et le departage,
 * pas un double qui les recite. Un `row_number()` mal ordonne ne se voit dans
 * aucun test unitaire — il se voit le jour ou deux joueurs a egalite changent
 * de place d'un rafraichissement a l'autre.
 */

try {
  process.loadEnvFile(new URL('../../../../../../.env', import.meta.url));
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

const NOW = Date.now();
const created: string[] = [];
let seasonId = '';

beforeAll(async () => {
  if (prisma === null) return;
  const season = await prisma.season.findFirst({
    where: { startsAt: { lte: new Date(NOW) }, endsAt: { gte: new Date(NOW) } },
    select: { id: true },
  });
  seasonId = season?.id ?? '';

  // Dix joueurs de test, dont deux a egalite parfaite : c'est le departage
  // qu'on veut voir tenir.
  for (let i = 0; i < 10; i++) {
    const player = await prisma.player.create({
      data: { displayName: `Classe ${String(i)}` },
      select: { id: true },
    });
    created.push(player.id);
    await prisma.rating.create({
      data: {
        playerId: player.id,
        seasonId,
        leaguePoints: i < 2 ? 9_000 : 8_000 - i * 10,
        wins: i,
        losses: 1,
      },
    });
  }
});

afterAll(async () => {
  if (prisma !== null && created.length > 0) {
    await prisma.player.deleteMany({ where: { id: { in: created } } });
  }
  await prisma?.$disconnect();
});

describe.skipIf(!reachable)('classement general', () => {
  const repository = (): PrismaRatingRepository =>
    new PrismaRatingRepository(prisma as never, null as never);

  it('classe par points decroissants', async () => {
    const top = await repository().top(10, NOW);
    const points = top.map((row) => row.leaguePoints);
    expect([...points].sort((a, b) => b - a)).toEqual(points);
  });

  it('numerote a partir de un, sans trou', async () => {
    const top = await repository().top(5, NOW);
    expect(top.map((row) => row.rank)).toEqual([1, 2, 3, 4, 5]);
  });

  /*
    Deux joueurs a egalite parfaite doivent garder le MEME ordre d'une requete
    a l'autre. Sans departage explicite, Postgres est libre de les rendre dans
    n'importe quel ordre — et un classement ou l'on monte et descend sans rien
    faire ne se croit plus.
  */
  it('departage deux egalites de facon stable', async () => {
    const premier = await repository().top(10, NOW);
    const second = await repository().top(10, NOW);
    expect(premier.map((r) => r.playerId)).toEqual(second.map((r) => r.playerId));
  });

  it('rend le nom du joueur, pas seulement son identifiant', async () => {
    const top = await repository().top(3, NOW);
    expect(top.every((row) => row.displayName.length > 0)).toBe(true);
  });

  /*
    La ligue doit sortir dans la forme du DOMAINE, pas celle de la colonne.

    Une requete SQL brute rend `r.league::text`, c'est-a-dire le nom de la
    valeur d'enum Postgres — `INFINIE` la ou le client attend `infinie`. Le
    defaut ne se voit nulle part dans le code : les deux cotes manipulent des
    chaines, et elles se ressemblent. Il s'est vu a l'ecran, ou toutes les
    lignes affichaient « Non classe ».
  */
  it('traduit la ligue dans la forme du domaine', async () => {
    const top = await repository().top(5, NOW);
    for (const row of top) {
      expect(row.league).toBe(row.league.toLowerCase());
      expect(row.league).not.toBe('');
    }
  });

  it('rend le joueur et ses voisins', async () => {
    const cible = created[5] ?? '';
    const voisinage = await repository().around(cible, 2, NOW);

    expect(voisinage).not.toBeNull();
    expect(voisinage?.me.playerId).toBe(cible);
    // Deux de chaque cote, plus soi : cinq, sauf en bord de classement.
    expect(voisinage?.rows.length).toBeLessThanOrEqual(5);
    expect(voisinage?.rows.some((row) => row.playerId === cible)).toBe(true);
  });

  it('rend un voisinage ordonne par rang', async () => {
    const voisinage = await repository().around(created[5] ?? '', 2, NOW);
    const rangs = voisinage?.rows.map((row) => row.rank) ?? [];
    expect([...rangs].sort((a, b) => a - b)).toEqual(rangs);
  });

  /*
    Un joueur qui n'a jamais fini de match classe n'a pas de ligne. L'ecran
    doit le dire plutot que d'inventer un rang.
  */
  it('rend null pour un joueur sans classement', async () => {
    const sansClassement = await prisma!.player.create({
      data: { displayName: 'Jamais joue' },
      select: { id: true },
    });
    created.push(sansClassement.id);

    await expect(repository().around(sansClassement.id, 2, NOW)).resolves.toBeNull();
  });
});
