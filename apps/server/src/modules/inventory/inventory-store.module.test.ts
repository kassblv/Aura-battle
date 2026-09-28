import { Inject, Injectable, Module } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { describe, expect, it } from 'vitest';
import { PrismaService } from '../../shared/prisma.service.js';
import { AuthModule } from '../auth/auth.module.js';
import { PrismaInventoryRepository } from './adapters/prisma-inventory.repository.js';
import { InventoryStoreModule } from './inventory-store.module.js';

/**
 * Le depot d'inventaire existe en UN exemplaire.
 *
 * Il etait declare a la fois par `MatchModule` et par `InventoryModule` : deux
 * exemplaires, donc deux caches du catalogue. Les deux modules l'importent
 * desormais du meme endroit.
 *
 * Le test monte le vrai module, avec un `AuthModule` reduit a `PrismaService` :
 * ce qu'il verifie, c'est le cablage — un seul exemplaire, et sa dependance
 * injectee (esbuild n'emet pas `design:paramtypes`, une injection manquee
 * donnerait `undefined` sans bruit).
 */

const prisma = { marker: 'prisma-double' };

@Module({
  providers: [{ provide: PrismaService, useValue: prisma }],
  exports: [PrismaService],
})
class FakeAuthModule {}

/** Deux consommateurs, dans deux modules, comme `match` et `inventory`. */
@Injectable()
class FirstConsumer {
  constructor(@Inject(PrismaInventoryRepository) readonly repository: PrismaInventoryRepository) {}
}

@Injectable()
class SecondConsumer {
  constructor(@Inject(PrismaInventoryRepository) readonly repository: PrismaInventoryRepository) {}
}

@Module({ imports: [InventoryStoreModule], providers: [FirstConsumer], exports: [FirstConsumer] })
class FirstModule {}

@Module({ imports: [InventoryStoreModule], providers: [SecondConsumer], exports: [SecondConsumer] })
class SecondModule {}

describe('InventoryStoreModule', () => {
  it('partage un seul depot, avec sa base injectee', async () => {
    const moduleRef = await Test.createTestingModule({ imports: [FirstModule, SecondModule] })
      .overrideModule(AuthModule)
      .useModule(FakeAuthModule)
      .compile();

    const first = moduleRef.get(FirstConsumer).repository;
    const second = moduleRef.get(SecondConsumer).repository;

    expect(first).toBeInstanceOf(PrismaInventoryRepository);
    expect(second).toBe(first);
    expect((first as unknown as { prisma: unknown }).prisma).toBe(prisma);
    await moduleRef.close();
  });
});
