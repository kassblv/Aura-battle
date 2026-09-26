import { Inject, Injectable } from '@nestjs/common';
import { PrismaService } from '../../../shared/prisma.service.js';
import { utcTimestamp } from '../../analytics/adapters/sql-time.js';
import type { FlagAssignmentEntry, FlagAssignmentStore } from '../domain/ports.js';

/**
 * Adaptateur Prisma du port `FlagAssignmentStore`.
 *
 * Une seule instruction : la ligne est tiree de `Player`, donc un joueur
 * inconnu (compte supprime entre l'ouverture et l'ecriture) n'insere rien au
 * lieu de lever une erreur de cle etrangere ; la cle `(playerId, flag)` rend
 * un renvoi sans effet. Requete brute parce que Prisma n'exprime pas un
 * `INSERT … SELECT … ON CONFLICT DO NOTHING` ; toutes les valeurs sont des
 * parametres.
 */
@Injectable()
export class PrismaFlagAssignmentStore implements FlagAssignmentStore {
  // Jeton explicite : esbuild n'emet pas `design:paramtypes` (voir CLAUDE.md).
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async record(entry: FlagAssignmentEntry): Promise<void> {
    await this.prisma.$executeRaw`
      INSERT INTO "FlagAssignment" ("playerId", "flag", "group", "assignedAt")
      SELECT p.id, ${entry.flag}, ${entry.group}::"FlagGroup", ${utcTimestamp(entry.atMs)}
      FROM "Player" p
      WHERE p.id = ${entry.playerId}
      ON CONFLICT ("playerId", "flag") DO NOTHING
    `;
  }
}
