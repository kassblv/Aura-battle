import { Controller, Get, Header, Inject, UseGuards } from '@nestjs/common';
import { ExperimentsService } from '../../analytics/application/experiments.service.js';
import type { ExperimentReport } from '../../analytics/domain/experiments.js';
import { IndicatorsService } from '../../analytics/application/indicators.service.js';
import type { IndicatorReport } from '../../analytics/domain/indicators.js';
import { AdminStatusService, type AdminStatus } from '../application/admin-status.service.js';
import { AdminGuard } from './admin.guard.js';

/**
 * Les lectures du tableau de bord (docs/10) : sante, indicateurs, experiences.
 *
 * Toutes derriere `AdminGuard` : 404 sans `ADMIN_TOKEN`, 429 apres dix essais
 * rates dans la minute, 401 sans le bon secret, comparaison a temps constant.
 * Les ecritures du panneau (ADR 0018) vivent dans `AdminManageController`, la
 * page dans `AdminAppController`.
 */
@Controller('admin')
@UseGuards(AdminGuard)
export class AdminController {
  // Jetons explicites : esbuild n'emet pas `design:paramtypes` (voir CLAUDE.md).
  constructor(
    @Inject(AdminStatusService) private readonly status: AdminStatusService,
    @Inject(IndicatorsService) private readonly indicators: IndicatorsService,
    @Inject(ExperimentsService) private readonly experiments: ExperimentsService,
  ) {}

  @Get('status')
  @Header('cache-control', 'no-store')
  async read(): Promise<AdminStatus> {
    return this.status.read();
  }

  /**
   * Les indicateurs produit de docs/00 (spec 2026-09-26), calcules a l'heure
   * du serveur.
   *
   * Des agregats sur toute la base : c'est pour cela qu'ils ne partent pas
   * avec `/admin/status`, que le panneau relit toutes les quinze secondes.
   */
  @Get('indicators')
  @Header('cache-control', 'no-store')
  async readIndicators(): Promise<IndicatorReport> {
    return this.indicators.report();
  }

  /**
   * Les tests A/B en cours (spec 2026-09-26) : par drapeau et par groupe, les
   * definitions des indicateurs restreintes aux joueurs du groupe, pour la
   * MESURE en cours seulement (epoque du drapeau).
   */
  @Get('experiments')
  @Header('cache-control', 'no-store')
  async readExperiments(): Promise<ExperimentReport> {
    return this.experiments.report();
  }
}
