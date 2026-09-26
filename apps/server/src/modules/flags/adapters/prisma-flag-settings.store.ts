import { Inject, Injectable } from '@nestjs/common';
import type { AdminAuditEntry } from '../../../shared/admin-audit.js';
import { writeAdminAction } from '../../../shared/admin-audit.prisma.js';
import { PrismaService } from '../../../shared/prisma.service.js';
import type { FlagName, FlagSettingState } from '../domain/flags.js';
import type { FlagSettingsStore } from '../domain/ports.js';

interface FlagSettingRow {
  flag: string;
  rollout: number;
  measureRollout: number;
  epoch: number;
  measureStartedAt: Date;
}

const toState = (row: FlagSettingRow): FlagSettingState => ({
  // Le nom vient de la base : `FeatureFlags` ignore ceux que le code ne declare pas.
  flag: row.flag as FlagName,
  rollout: row.rollout,
  measureRollout: row.measureRollout,
  epoch: row.epoch,
  measureStartedAtMs: row.measureStartedAt.getTime(),
});

/**
 * Adaptateur Prisma du port `FlagSettingsStore` (table `FlagSetting`).
 *
 * L'initialisation est un `createMany … skipDuplicates` : deux noeuds qui
 * demarrent ensemble ne se battent pas, et une ligne existante n'est jamais
 * remplacee par l'environnement. Une transition verrouille la ligne
 * (`FOR UPDATE`) : deux « nouvelle mesure » simultanees donnent deux epoques
 * successives, jamais deux fois la meme.
 */
@Injectable()
export class PrismaFlagSettingsStore implements FlagSettingsStore {
  // Jeton explicite : esbuild n'emet pas `design:paramtypes` (voir CLAUDE.md).
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async loadAll(initial: readonly FlagSettingState[]): Promise<FlagSettingState[]> {
    if (initial.length > 0) {
      await this.prisma.flagSetting.createMany({
        data: initial.map((state) => ({
          flag: state.flag,
          rollout: state.rollout,
          measureRollout: state.measureRollout,
          epoch: state.epoch,
          measureStartedAt: new Date(state.measureStartedAtMs),
        })),
        skipDuplicates: true,
      });
    }
    const rows = await this.prisma.flagSetting.findMany({ orderBy: { flag: 'asc' } });
    return rows.map(toState);
  }

  async transition(
    flag: FlagName,
    next: (current: FlagSettingState) => FlagSettingState,
    audit: (before: FlagSettingState, after: FlagSettingState) => AdminAuditEntry,
  ): Promise<FlagSettingState> {
    return this.prisma.$transaction(async (tx) => {
      const [row] = await tx.$queryRaw<FlagSettingRow[]>`
        SELECT "flag", "rollout", "measureRollout", "epoch", "measureStartedAt"
        FROM "FlagSetting" WHERE "flag" = ${flag} FOR UPDATE
      `;
      if (row === undefined) throw new Error(`reglage absent pour « ${flag} »`);
      const before = toState(row);
      const after = next(before);
      await tx.flagSetting.update({
        where: { flag },
        data: {
          rollout: after.rollout,
          measureRollout: after.measureRollout,
          epoch: after.epoch,
          measureStartedAt: new Date(after.measureStartedAtMs),
        },
      });
      await writeAdminAction(tx, audit(before, after));
      return after;
    });
  }
}
