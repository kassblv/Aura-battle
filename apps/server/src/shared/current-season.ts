import type { PrismaService } from './prisma.service.js';

/**
 * Saison qui encadre un instant donne (docs/04, modele `Season`).
 *
 * Partagee par tout ce qui lit ou ecrit un `Rating` : la file d'attente
 * (`matchmaking/adapters/prisma-rating.reader.ts`) et le classement
 * (`rating/adapters/prisma-rating.repository.ts`) doivent choisir exactement
 * la meme saison pour le meme instant, sous peine de faire jouer un match
 * classe sur une saison et d'en ecrire le resultat sur une autre.
 *
 * La saison est determinee par **l'instant recu**, jamais par `new Date()` ni
 * par « la derniere creee » : une saison preparee a l'avance viderait sinon le
 * classement de tout le monde avant l'heure.
 */
export async function currentSeasonId(
  prisma: PrismaService,
  nowMs: number,
): Promise<string | null> {
  const at = new Date(nowMs);
  const season = await prisma.season.findFirst({
    where: { startsAt: { lte: at }, endsAt: { gt: at } },
    orderBy: { number: 'desc' },
    select: { id: true },
  });
  return season?.id ?? null;
}
