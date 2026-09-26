import { Inject, Injectable } from '@nestjs/common';
import { PrismaService } from '../../../shared/prisma.service.js';
import type { AdminAuditReader, AdminAuditRow } from '../domain/ports.js';

/** Lecture du journal d'administration (`AdminAction`, index sur `at`). */
@Injectable()
export class PrismaAdminAuditReader implements AdminAuditReader {
  // Jeton explicite : esbuild n'emet pas `design:paramtypes` (voir CLAUDE.md).
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async latest(
    filter: { readonly action?: string; readonly target?: string },
    limit: number,
  ): Promise<readonly AdminAuditRow[]> {
    return this.prisma.adminAction.findMany({
      where: {
        ...(filter.action === undefined ? {} : { action: filter.action }),
        ...(filter.target === undefined ? {} : { target: filter.target }),
      },
      orderBy: [{ at: 'desc' }, { id: 'desc' }],
      take: limit,
      select: {
        id: true,
        at: true,
        action: true,
        target: true,
        before: true,
        after: true,
        reason: true,
      },
    });
  }
}
