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
