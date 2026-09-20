import { Inject, Injectable } from '@nestjs/common';
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

    /**
     * La saison est determinee par l'instant recu, jamais par `new Date()`.
     *
     * Une saison future peut etre creee a l'avance : prendre « la derniere
     * saison » sans regarder ses dates ferait basculer tout le monde sur un
     * classement vide avant l'heure.
     */
    const at = new Date(nowMs);
    const season = await this.prisma.season.findFirst({
      where: { startsAt: { lte: at }, endsAt: { gt: at } },
      orderBy: { number: 'desc' },
      select: { id: true },
    });
    if (season === null) return new Map();

    const ratings = await this.prisma.rating.findMany({
      where: { seasonId: season.id, playerId: { in: [...playerIds] } },
      select: { playerId: true, mmr: true },
    });

    return new Map(ratings.map((rating) => [rating.playerId, rating.mmr]));
  }
}
