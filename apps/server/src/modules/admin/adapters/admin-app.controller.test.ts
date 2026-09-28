import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { CONFIG, type ServerConfig } from '../../../shared/config.js';
import { ADMIN_APP_DIR, AdminAppController } from './admin-app.controller.js';

/**
 * L'application admin servie par Nest sous `/admin/` (ADR 0018) : la page
 * pour `/admin` et `/admin/`, les fichiers du build sous `/admin/assets/`,
 * 404 sans `ADMIN_TOKEN` comme le reste du panneau. Un dossier factice tient
 * lieu de build : l'application se construit ailleurs.
 */
const SECRET = 'secret-d-administration-assez-long';
const config = { adminToken: SECRET } as ServerConfig & { adminToken: string };
const INDEX =
  '<!doctype html><html><head><script type="module" src="/admin/assets/index-B7xQ2kLm.js"></script></head><body><div id="root"></div></body></html>';

let dir: string;
let missing: string;
let app: NestFastifyApplication;
let bare: NestFastifyApplication;

async function start(appDir: string): Promise<NestFastifyApplication> {
  const moduleRef = await Test.createTestingModule({
    controllers: [AdminAppController],
    providers: [
      { provide: CONFIG, useValue: config },
      { provide: ADMIN_APP_DIR, useValue: appDir },
    ],
  }).compile();
  const instance = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
  await instance.init();
  await instance.getHttpAdapter().getInstance().ready();
  return instance;
}

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'aura-admin-'));
  await mkdir(join(dir, 'assets'));
  await writeFile(join(dir, 'index.html'), INDEX);
  await writeFile(join(dir, 'assets', 'index-B7xQ2kLm.js'), 'console.log("admin")');
  await writeFile(join(dir, 'assets', 'index-C9aa_-01.css'), 'body{}');
  await writeFile(join(dir, 'assets', 'logo.svg'), '<svg/>');
  await writeFile(join(dir, 'secret.txt'), 'ne doit jamais sortir');
  missing = join(dir, 'absent');
  app = await start(dir);
  bare = await start(missing);
});

afterAll(async () => {
  await app.close();
  await bare.close();
  await rm(dir, { recursive: true, force: true });
});

beforeEach(() => {
  config.adminToken = SECRET;
});

const get = (url: string, target = app) => target.inject({ method: 'GET', url });

describe('page de l application admin', () => {
  it.each(['/admin', '/admin/'])('%s rend index.html, jamais mis en cache', async (url) => {
    const reply = await get(url);
    expect(reply.statusCode).toBe(200);
    expect(reply.headers['content-type']).toBe('text/html; charset=utf-8');
    expect(reply.headers['cache-control']).toBe('no-store');
    expect(reply.body).toBe(INDEX);
    // Pas d'encadrement par un site tiers, pas de script d'ailleurs.
    expect(reply.headers['content-security-policy']).toContain("frame-ancestors 'none'");
    expect(reply.headers['content-security-policy']).toContain("script-src 'self'");
    expect(reply.headers['x-content-type-options']).toBe('nosniff');
  });

  it.each(['/admin', '/admin/', '/admin/assets/index-B7xQ2kLm.js'])(
    '%s : 404 sans secret configure',
    async (url) => {
      config.adminToken = '';
      expect((await get(url)).statusCode).toBe(404);
    },
  );

  it('sans build, une page minimale le dit', async () => {
    const reply = await get('/admin', bare);
    expect(reply.statusCode).toBe(200);
    expect(reply.body).toContain('Application admin non construite');
    expect((await get('/admin/assets/index-B7xQ2kLm.js', bare)).statusCode).toBe(404);
  });

  it('une autre adresse sous /admin/ reste une 404', async () => {
    expect((await get('/admin/joueurs')).statusCode).toBe(404);
    expect((await get('/admin/secret.txt')).statusCode).toBe(404);
    expect((await get('/admin/index.html')).statusCode).toBe(404);
  });
});

describe('fichiers du build', () => {
  it('sert un fichier hache avec un cache immuable et le bon type', async () => {
    const js = await get('/admin/assets/index-B7xQ2kLm.js');
    expect(js.statusCode).toBe(200);
    expect(js.headers['content-type']).toBe('text/javascript; charset=utf-8');
    expect(js.headers['cache-control']).toBe('public, max-age=31536000, immutable');
    expect(js.body).toBe('console.log("admin")');

    const css = await get('/admin/assets/index-C9aa_-01.css');
    expect(css.headers['content-type']).toBe('text/css; charset=utf-8');
    expect(css.headers['cache-control']).toBe('public, max-age=31536000, immutable');
  });

  it('un fichier non hache n est pas fige dans les caches', async () => {
    const svg = await get('/admin/assets/logo.svg');
    expect(svg.statusCode).toBe(200);
    expect(svg.headers['content-type']).toBe('image/svg+xml');
    expect(svg.headers['cache-control']).toBe('no-cache');
  });

  it.each([
    '/admin/assets/absent-12345678.js',
    '/admin/assets/..%2Fsecret.txt',
    '/admin/assets/..%2F..%2Findex.html',
    '/admin/assets/%2E%2E%2Fsecret.txt',
    '/admin/assets/.hidden.js',
    '/admin/assets/sans-extension',
    '/admin/assets/x.exe',
  ])('%s : 404', async (url) => {
    expect((await get(url)).statusCode).toBe(404);
  });
});
