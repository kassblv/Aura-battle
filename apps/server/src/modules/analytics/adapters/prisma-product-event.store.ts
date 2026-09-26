import { Inject, Injectable } from '@nestjs/common';
import { PrismaService } from '../../../shared/prisma.service.js';
import type { ProductEventEntry, ProductEventStore } from '../domain/ports.js';
import { utcTimestamp } from './sql-time.js';

/**
 * Adaptateur Prisma du port `ProductEventStore`.
 *
 * Une seule instruction fait le controle ET l'ecriture : la ligne est tiree
 * du siege du joueur (`MatchSeat`), donc elle n'existe que s'il a siege a ce
 * match ; la cle primaire `(playerId, matchId, kind)` rend un renvoi sans
 * effet (`ON CONFLICT DO NOTHING`). Pas de lecture prealable, donc pas de
 * fenetre entre les deux, et deux renvois simultanes ne levent rien.
 *
 * Requete brute parce que Prisma n'exprime pas un `INSERT … SELECT` : c'est la
 * place d'une requete brute, un adaptateur Postgres (docs/02). Toutes les
 * valeurs sont des parametres, jamais concatenees.
 */
@Injectable()
export class PrismaProductEventStore implements ProductEventStore {
  // Jeton explicite : esbuild n'emet pas `design:paramtypes` (voir CLAUDE.md).
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async recordIfSeated(entry: ProductEventEntry): Promise<boolean> {
    const inserted = await this.prisma.$executeRaw`
      INSERT INTO "ProductEvent" ("playerId", "matchId", "kind", "createdAt")
      SELECT s."playerId", s."matchId", ${entry.kind}, ${utcTimestamp(entry.atMs)}
      FROM "MatchSeat" s
      WHERE s."matchId" = ${entry.matchId} AND s."playerId" = ${entry.playerId}
      LIMIT 1
      ON CONFLICT ("playerId", "matchId", "kind") DO NOTHING
    `;
    return inserted > 0;
  }
}
