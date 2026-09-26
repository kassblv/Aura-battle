import { Inject, Injectable } from '@nestjs/common';
import type { AdminAuditEntry } from '../../../shared/admin-audit.js';
import { writeAdminAction } from '../../../shared/admin-audit.prisma.js';
import { PrismaService } from '../../../shared/prisma.service.js';
import type { RuleEventStore } from '../domain/ports.js';

/**
 * Adaptateur Prisma du port `RuleEventStore` (table `RuleEventOverride`).
 *
 * L'ecriture verrouille la ligne visee (`FOR UPDATE`) pour que la variante
 * « avant » du journal soit celle qu'on remplace vraiment, meme si deux
 * onglets du panneau forcent la meme semaine au meme instant.
 */
@Injectable()
export class PrismaRuleEventStore implements RuleEventStore {
  // Jeton explicite : esbuild n'emet pas `design:paramtypes` (voir CLAUDE.md).
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async loadFrom(fromWeek: number): Promise<ReadonlyMap<number, string>> {
    const rows = await this.prisma.ruleEventOverride.findMany({
      where: { week: { gte: fromWeek } },
      select: { week: true, variant: true },
    });
    return new Map(rows.map((row) => [row.week, row.variant]));
  }

  async setOverride(
    week: number,
    variant: string | null,
    audit: (before: string | null) => AdminAuditEntry,
  ): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const [row] = await tx.$queryRaw<{ variant: string }[]>`
        SELECT "variant" FROM "RuleEventOverride" WHERE "week" = ${week}::int FOR UPDATE
      `;
      if (variant === null) {
        await tx.ruleEventOverride.deleteMany({ where: { week } });
      } else {
        await tx.ruleEventOverride.upsert({
          where: { week },
          create: { week, variant },
          update: { variant },
        });
      }
      await writeAdminAction(tx, audit(row?.variant ?? null));
    });
  }
}
