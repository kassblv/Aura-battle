import { describe, expect, it } from 'vitest';
import type { PrismaService } from '../../../shared/prisma.service.js';
import { PrismaRatingReader } from './prisma-rating.reader.js';

/**
 * Ce que l'adaptateur **demande** a Prisma, et ce qu'il fait de la reponse.
 *
 * Deux traductions comptent : la saison est choisie par l'instant recu — pas
 * par « la derniere creee », sans quoi une saison preparee a l'avance viderait
 * le classement de tout le monde — et un joueur sans ligne de classement sort
 * simplement absent de la carte, charge au service de lui donner la valeur de
 * depart.
 */

interface SeasonArgs {
  readonly where: {
    readonly startsAt: { readonly lte: Date };
    readonly endsAt: { readonly gt: Date };
  };
}

interface RatingArgs {
  readonly where: { readonly seasonId: string; readonly playerId: { readonly in: string[] } };
}

class FakePrisma {
  lastSeasonQuery: SeasonArgs | null = null;
  lastRatingQuery: RatingArgs | null = null;
  currentSeason: { id: string } | null = { id: 's_1' };
  rows: { playerId: string; mmr: number }[] = [];

  readonly season = {
    findFirst: (args: SeasonArgs): Promise<{ id: string } | null> => {
      this.lastSeasonQuery = args;
      return Promise.resolve(this.currentSeason);
    },
  };

  readonly rating = {
    findMany: (args: RatingArgs): Promise<{ playerId: string; mmr: number }[]> => {
      this.lastRatingQuery = args;
      return Promise.resolve(this.rows);
    },
  };

  asService(): PrismaService {
    return this as unknown as PrismaService;
  }
}

const NOW = Date.parse('2026-09-20T10:00:00Z');

function build(): { prisma: FakePrisma; reader: PrismaRatingReader } {
  const prisma = new FakePrisma();
  return { prisma, reader: new PrismaRatingReader(prisma.asService()) };
}

describe('PrismaRatingReader', () => {
  it('cherche la saison qui encadre l instant recu', async () => {
    const { prisma, reader } = build();
    await reader.mmrOf(['p1'], NOW);

    expect(prisma.lastSeasonQuery?.where.startsAt.lte).toEqual(new Date(NOW));
    expect(prisma.lastSeasonQuery?.where.endsAt.gt).toEqual(new Date(NOW));
  });

  it('rend le MMR de chaque joueur trouve', async () => {
    const { prisma, reader } = build();
    prisma.rows = [
      { playerId: 'p1', mmr: 1240 },
      { playerId: 'p2', mmr: 980 },
    ];

    const found = await reader.mmrOf(['p1', 'p2'], NOW);

    expect(found.get('p1')).toBe(1240);
    expect(found.get('p2')).toBe(980);
    expect(prisma.lastRatingQuery?.where.seasonId).toBe('s_1');
    expect(prisma.lastRatingQuery?.where.playerId.in).toEqual(['p1', 'p2']);
  });

  it('laisse absent un joueur sans ligne de classement', async () => {
    const { prisma, reader } = build();
    prisma.rows = [{ playerId: 'p1', mmr: 1240 }];

    const found = await reader.mmrOf(['p1', 'jamais-classe'], NOW);

    expect(found.has('jamais-classe')).toBe(false);
  });

  /** Hors saison, personne n'est classe — et tout le monde joue quand meme. */
  it('rend une carte vide quand aucune saison ne court', async () => {
    const { prisma, reader } = build();
    prisma.currentSeason = null;

    expect((await reader.mmrOf(['p1'], NOW)).size).toBe(0);
    expect(prisma.lastRatingQuery).toBeNull();
  });

  it('n interroge pas la base pour une liste vide', async () => {
    const { prisma, reader } = build();

    expect((await reader.mmrOf([], NOW)).size).toBe(0);
    expect(prisma.lastSeasonQuery).toBeNull();
  });
});
