import { Inject, Injectable } from '@nestjs/common';
import { PrismaService } from '../../../shared/prisma.service.js';
import type { PlayerDirectory } from '../domain/directory.js';

/**
 * Annuaire des joueurs, lu dans Postgres.
 *
 * Une seule requete pour les deux sieges, et rien d'autre que le nom : ce
 * module n'a aucune raison de charger l'inventaire ou le classement de qui que
 * ce soit pour afficher un bandeau de match.
 */
@Injectable()
export class PrismaPlayerDirectory implements PlayerDirectory {
  // Jeton explicite : esbuild n'emet pas `design:paramtypes` (voir auth.controller.ts).
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async displayNames(playerIds: readonly string[]): Promise<ReadonlyMap<string, string>> {
    if (playerIds.length === 0) return new Map();
    const players = await this.prisma.player.findMany({
      where: { id: { in: [...playerIds] } },
      select: { id: true, displayName: true },
    });
    return new Map(players.map((player) => [player.id, player.displayName]));
  }
}
