import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Controller, Get, Inject, NotFoundException, Param, Req, Res } from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { CONFIG, type ServerConfig } from '../../../shared/config.js';

/** Jeton d'injection du dossier du build de `apps/admin`. */
export const ADMIN_APP_DIR = Symbol('ADMIN_APP_DIR');

/**
 * Un nom de fichier du build, et rien d'autre : pas de `/`, pas de point en
 * tete, une extension connue. C'est cette forme — et non une resolution de
 * chemin apres coup — qui rend une traversee (`../`) impossible : un nom qui
 * ne peut pas contenir de separateur ne sort pas du dossier.
 */
const ASSET_NAME = /^[A-Za-z0-9][A-Za-z0-9_-]*(?:\.[A-Za-z0-9_-]+)*\.([a-z0-9]+)$/;

const CONTENT_TYPES: Readonly<Record<string, string>> = {
  js: 'text/javascript; charset=utf-8',
  css: 'text/css; charset=utf-8',
  svg: 'image/svg+xml',
  png: 'image/png',
  webp: 'image/webp',
  ico: 'image/x-icon',
  woff2: 'font/woff2',
  json: 'application/json; charset=utf-8',
  map: 'application/json; charset=utf-8',
};

/** Vite suffixe ses fichiers d'un hachage de huit caracteres (`index-B7xQ2kLm.js`). */
const HASHED = /-[A-Za-z0-9_-]{8,}\.[a-z0-9]+$/;

/**
 * Politique de contenu de la page : scripts et styles du meme hote, appels a
 * l'API du meme hote, aucun encadrement. Les styles en ligne restent permis :
 * React pose des attributs `style`, et ils ne portent pas de code.
 */
const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "connect-src 'self'",
  "font-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join('; ');

/** Ce qu'on sert tant que `apps/admin` n'a pas ete construite. */
const NOT_BUILT = `<!doctype html>
<html lang="fr">
<head><meta charset="utf-8" /><meta name="robots" content="noindex, nofollow" />
<title>Aura Battle — administration</title></head>
<body style="font-family: system-ui, sans-serif; background: #150c2e; color: #f3ecff; padding: 32px;">
<h1>Application admin non construite</h1>
<p>Lance <code>pnpm --filter admin build</code>, ou <code>pnpm --filter admin dev</code> pour la developper.</p>
</body>
</html>
`;

/**
 * L'application d'administration (`apps/admin`), servie sous `/admin/` (ADR 0018).
 *
 * Jamais dans le paquet des joueurs : c'est une application a part, que seul
 * ce controleur sert — et seulement quand `ADMIN_TOKEN` est pose. Sans secret,
 * le panneau n'existe pas, pas meme sa page.
 *
 * Les routes d'API (`/admin/status`, `/admin/flags`…) sont des routes
 * statiques ou parametrees : le routeur les prefere toujours au joker ci-bas,
 * qui ne sert que `/admin/` et rend 404 pour tout le reste. L'application se
 * route par le hash (`#/joueurs`), elle n'a besoin d'aucune autre adresse.
 */
@Controller('admin')
export class AdminAppController {
  // Jetons explicites : esbuild n'emet pas `design:paramtypes` (voir CLAUDE.md).
  constructor(
    @Inject(CONFIG) private readonly config: ServerConfig,
    @Inject(ADMIN_APP_DIR) private readonly dir: string,
  ) {}

  @Get()
  async page(@Res({ passthrough: true }) reply: FastifyReply): Promise<string> {
    this.requireEnabled();
    return this.index(reply);
  }

  /** Le joker : `/admin/` et rien d'autre. */
  @Get('*')
  async slash(
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<string> {
    this.requireEnabled();
    if (request.url.split('?')[0] !== '/admin/') {
      throw new NotFoundException({ code: 'NOT_FOUND' });
    }
    return this.index(reply);
  }

  @Get('assets/:file')
  async asset(
    @Param('file') file: string,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<Buffer> {
    this.requireEnabled();
    const match = ASSET_NAME.exec(file);
    const type = match === null ? undefined : CONTENT_TYPES[match[1] ?? ''];
    if (type === undefined) throw new NotFoundException({ code: 'NOT_FOUND' });

    let body: Buffer;
    try {
      body = await readFile(join(this.dir, 'assets', file));
    } catch {
      throw new NotFoundException({ code: 'NOT_FOUND' });
    }
    void reply
      .header('content-type', type)
      .header('x-content-type-options', 'nosniff')
      // Un fichier hache ne change jamais sous son nom : il peut rester en cache
      // un an. Les autres se revalident, sinon un deploiement ne se verrait pas.
      .header(
        'cache-control',
        HASHED.test(file) ? 'public, max-age=31536000, immutable' : 'no-cache',
      );
    return body;
  }

  /** La page, jamais mise en cache : elle porte les noms hachés du build en cours. */
  private async index(reply: FastifyReply): Promise<string> {
    let html: string;
    try {
      html = await readFile(join(this.dir, 'index.html'), 'utf8');
    } catch {
      html = NOT_BUILT;
    }
    void reply
      .header('content-type', 'text/html; charset=utf-8')
      .header('cache-control', 'no-store')
      .header('content-security-policy', CONTENT_SECURITY_POLICY)
      .header('x-content-type-options', 'nosniff')
      .header('referrer-policy', 'no-referrer')
      .header('x-robots-tag', 'noindex, nofollow');
    return html;
  }

  /**
   * `404` quand aucun secret n'est pose : sans `ADMIN_TOKEN`, le panneau
   * n'existe pas — pas meme sa porte.
   */
  private requireEnabled(): void {
    if (this.config.adminToken === '') throw new NotFoundException({ code: 'NOT_FOUND' });
  }
}
