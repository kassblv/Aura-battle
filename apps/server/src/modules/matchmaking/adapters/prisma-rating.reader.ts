import { Inject, Injectable } from '@nestjs/common';
import { currentSeasonId } from '../../../shared/current-season.js';
import { PrismaService } from '../../../shared/prisma.service.js';
import type { RatingReader } from '../domain/ports.js';

/**
 * Lecture du MMR de la saison en cours (docs/04, modele `Rating`).
 *
 * **Lecture seule.** Calculer, mettre a jour ou convertir un MMR en points de
 * ligue est une autre ligne du jalon M5 ; l'appariement se contente de lire ce
 * que la base contient deja. Un joueur sans ligne de classement — tout le monde
 * aujourd'hui, puisque rien n'ecrit encore ce modele — est simplement absent de
 * la reponse, et le service lui donne la valeur de depart.
 */
@Injectable()
export class PrismaRatingReader implements RatingReader {
  // Jeton explicite : esbuild n'emet pas `design:paramtypes` (voir CLAUDE.md).
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async mmrOf(playerIds: readonly string[], nowMs: number): Promise<ReadonlyMap<string, number>> {
    if (playerIds.length === 0) return new Map();

    const seasonId = await currentSeasonId(this.prisma, nowMs);
    if (seasonId === null) return new Map();

    const ratings = await this.prisma.rating.findMany({
      where: { seasonId, playerId: { in: [...playerIds] } },
      select: { playerId: true, mmr: true },
    });

    return new Map(ratings.map((rating) => [rating.playerId, rating.mmr]));
  }
}
