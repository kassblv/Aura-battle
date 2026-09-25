import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import { TOKEN_PACKS } from '@aura/content';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CONFIG } from '../../../shared/config.js';
import { PinoLoggerService } from '../../../shared/logger.js';
import { TOKEN_LEDGER, type TokenCredit, type TokenLedger } from '../domain/ports.js';
import { PaymentsController } from './payments.controller.js';

const SECRET = 's'.repeat(40);
const PLAYER = '811fa70a-c2cc-4f2e-832e-b1c662c7bd31';

/** Le grand livre en memoire, avec l'idempotence de la base. */
const granted: TokenCredit[] = [];
const ledger: TokenLedger = {
  grant: (credit) => {
    if (granted.some((g) => g.eventId === credit.eventId)) return Promise.resolve('duplicate');
    granted.push(credit);
    return Promise.resolve('granted');
  },
};
const warnings: string[] = [];

async function build(secret: string): Promise<NestFastifyApplication> {
  const moduleRef = await Test.createTestingModule({
    controllers: [PaymentsController],
    providers: [
      { provide: CONFIG, useValue: { revenuecatWebhookAuth: secret, revenuecatSandbox: false } },
      { provide: TOKEN_LEDGER, useValue: ledger },
      {
        provide: PinoLoggerService,
        useValue: { warn: (m: string) => warnings.push(m), log: () => undefined },
      },
    ],
  }).compile();
  const app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
  return app;
}

let app: NestFastifyApplication;
let closed: NestFastifyApplication;

beforeAll(async () => {
  app = await build(SECRET);
  closed = await build('');
});

afterAll(async () => {
  await app.close();
  await closed.close();
});

const purchase = (id: string) => ({
  api_version: '1.0',
  event: {
    id,
    type: 'NON_RENEWING_PURCHASE',
    app_user_id: PLAYER,
    product_id: TOKEN_PACKS[0]!.productId,
    environment: 'PRODUCTION',
    store: 'PLAY_STORE',
  },
});

const post = (target: NestFastifyApplication, body: unknown, authorization?: string) =>
  target.inject({
    method: 'POST',
    url: '/payments/revenuecat',
    ...(authorization === undefined ? {} : { headers: { authorization } }),
    payload: body as Record<string, unknown>,
  });

describe('POST /payments/revenuecat', () => {
  it('reste fermee sans secret configure', async () => {
    expect((await post(closed, purchase('e0'), SECRET)).statusCode).toBe(404);
  });

  it('refuse qui n a pas le secret', async () => {
    expect((await post(app, purchase('e1'))).statusCode).toBe(401);
    expect((await post(app, purchase('e1'), 'mauvais')).statusCode).toBe(401);
    expect(granted.some((g) => g.eventId === 'e1')).toBe(false);
  });

  it('credite un achat, une seule fois malgre les renvois', async () => {
    expect((await post(app, purchase('e2'), SECRET)).statusCode).toBe(200);
    expect((await post(app, purchase('e2'), `Bearer ${SECRET}`)).statusCode).toBe(200);
    expect(granted.filter((g) => g.eventId === 'e2')).toHaveLength(1);
    expect(granted.find((g) => g.eventId === 'e2')?.tokens).toBe(TOKEN_PACKS[0]!.tokens);
  });

  it('refuse un corps qui n est pas un evenement', async () => {
    expect((await post(app, { nope: true }, SECRET)).statusCode).toBe(400);
  });

  // Un evenement qu'on ne traite pas s'acquitte : sinon RevenueCat le renverrait sans fin.
  it('acquitte sans crediter un evenement ignore', async () => {
    const reply = await post(app, { event: { ...purchase('e3').event, type: 'TEST' } }, SECRET);
    expect(reply.statusCode).toBe(200);
    expect(granted.some((g) => g.eventId === 'e3')).toBe(false);
  });

  it('signale un remboursement sans rien debiter', async () => {
    const reply = await post(
      app,
      { event: { ...purchase('e4').event, type: 'CANCELLATION' } },
      SECRET,
    );
    expect(reply.statusCode).toBe(200);
    expect(warnings.some((w) => w.includes('rembours'))).toBe(true);
  });
});
