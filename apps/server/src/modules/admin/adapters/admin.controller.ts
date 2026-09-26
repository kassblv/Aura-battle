import {
  Controller,
  Get,
  Header,
  Headers,
  Inject,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { CONFIG, type ServerConfig } from '../../../shared/config.js';
import { constantTimeEquals } from '../../../shared/constant-time.js';
import { ExperimentsService } from '../../analytics/application/experiments.service.js';
import type { ExperimentReport } from '../../analytics/domain/experiments.js';
import { IndicatorsService } from '../../analytics/application/indicators.service.js';
import type { IndicatorReport } from '../../analytics/domain/indicators.js';
import { AdminStatusService, type AdminStatus } from '../application/admin-status.service.js';
import { ADMIN_PAGE } from './admin-page.js';

const BEARER = 'Bearer ';

/**
 * Le panneau d'administration (docs/10).
 *
 * **En lecture seule, entierement.** Aucune route n'ecrit : un panneau qui
 * agit est une porte de plus, et celle-ci serait la plus interessante du
 * systeme. On surveille d'abord.
 *
 * La page elle-meme ne contient aucun secret et se sert sans jeton — c'est
 * l'API qui garde. La separation est volontaire : une page protegee par
 * en-tete obligerait a bricoler l'authentification d'une navigation de
 * navigateur, alors qu'une page vide demandant un secret fait le meme travail
 * sans rien inventer.
 */
@Controller('admin')
export class AdminController {
  constructor(
    @Inject(AdminStatusService) private readonly status: AdminStatusService,
    @Inject(CONFIG) private readonly config: ServerConfig,
    @Inject(IndicatorsService) private readonly indicators: IndicatorsService,
    @Inject(ExperimentsService) private readonly experiments: ExperimentsService,
  ) {}

  /**
   * La page du panneau.
   *
   * `404` quand aucun secret n'est pose : sans `ADMIN_TOKEN`, le panneau
   * n'existe pas — pas meme sa porte. Annoncer « interdit » dirait a qui
   * cherche qu'il y a quelque chose a chercher.
   */
  @Get()
  @Header('content-type', 'text/html; charset=utf-8')
  @Header('cache-control', 'no-store')
  page(): string {
    this.requireEnabled();
    return ADMIN_PAGE;
  }

  @Get('status')
  @Header('cache-control', 'no-store')
  async read(@Headers('authorization') authorization?: string): Promise<AdminStatus> {
    this.requireEnabled();
    this.authorize(authorization);
    return this.status.read();
  }

  /**
   * Les indicateurs produit de docs/00 (spec 2026-09-26), calcules a l'heure
   * du serveur. Meme garde que l'etat : sans secret, la route n'existe pas.
   *
   * Des agregats sur toute la base : c'est pour cela qu'ils ne partent pas
   * avec `/admin/status`, que le panneau relit toutes les quinze secondes.
   */
  @Get('indicators')
  @Header('cache-control', 'no-store')
  async readIndicators(@Headers('authorization') authorization?: string): Promise<IndicatorReport> {
    this.requireEnabled();
    this.authorize(authorization);
    return this.indicators.report();
  }

  /**
   * Les tests A/B en cours (spec 2026-09-26) : par drapeau et par groupe, les
   * definitions des indicateurs restreintes aux joueurs du groupe. Meme garde,
   * meme cache d'une minute, memes raisons.
   */
  @Get('experiments')
  @Header('cache-control', 'no-store')
  async readExperiments(
    @Headers('authorization') authorization?: string,
  ): Promise<ExperimentReport> {
    this.requireEnabled();
    this.authorize(authorization);
    return this.experiments.report();
  }

  private requireEnabled(): void {
    if (this.config.adminToken === '') {
      throw new NotFoundException({ code: 'NOT_FOUND' });
    }
  }

  /**
   * Refuse qui n'a pas le secret.
   *
   * Comparaison a longueur constante : une egalite de chaines qui sort au
   * premier octet different laisse deviner le secret octet par octet.
   */
  private authorize(header: string | undefined): void {
    const offered = header?.startsWith(BEARER) === true ? header.slice(BEARER.length) : '';
    if (!constantTimeEquals(offered, this.config.adminToken)) {
      throw new UnauthorizedException({ code: 'UNAUTHORIZED' });
    }
  }
}
