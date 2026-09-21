import { Inject, Injectable } from '@nestjs/common';
import { PrismaService } from '../../../shared/prisma.service.js';
import type { InventoryRepository, LoadoutData, PlayerInventory } from '../domain/ports.js';
import type { CatalogueEntry, Wallet } from '../domain/purchase.js';

/** Leve quand la base refuse l'achat : objet deja possede, ou bourse a sec. */
export class PurchaseConflictError extends Error {
  constructor(cause?: unknown) {
    super('PURCHASE_CONFLICT', { cause });
    this.name = 'PurchaseConflictError';
  }
}

@Injectable()
export class PrismaInventoryRepository implements InventoryRepository {
  // Jeton explicite : esbuild n'emet pas `design:paramtypes` (voir auth.controller.ts).
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async catalogue(): Promise<readonly CatalogueEntry[]> {
    return this.prisma.cosmeticItem.findMany({
      select: {
        id: true,
        kind: true,
        priceSoft: true,
        priceHard: true,
        availableFrom: true,
        availableTo: true,
      },
    });
  }

  async read(playerId: string): Promise<PlayerInventory> {
    const [player, items, loadout] = await Promise.all([
      this.prisma.player.findUnique({
        where: { id: playerId },
        select: { softCurrency: true, hardCurrency: true },
      }),
      this.prisma.inventoryItem.findMany({ where: { playerId }, select: { itemId: true } }),
      this.prisma.loadout.findUnique({ where: { playerId }, select: { data: true } }),
    ]);

    return {
      wallet: { soft: player?.softCurrency ?? 0, hard: player?.hardCurrency ?? 0 },
      owned: items.map((item) => item.itemId),
      loadout: (loadout?.data as LoadoutData | undefined) ?? null,
    };
  }

  /**
   * Accorde l'objet et debite, en une transaction.
   *
   * **Deux gardes, pour deux courses differentes.**
   *
   * La creation de `InventoryItem` porte la cle primaire `(playerId, itemId)` :
   * elle tranche entre deux achats du MEME objet, ou le second doit repartir
   * sans debit plutot que de payer deux fois.
   *
   * Le debit, lui, est conditionnel (`softCurrency >= spend`) et compte les
   * lignes touchees. C'est la garde de l'autre course : deux objets
   * DIFFERENTS, payables chacun mais pas ensemble. La cle primaire ne la voit
   * pas — deux objets distincts, aucun conflit — et sans le `WHERE`, la bourse
   * passerait dans le negatif.
   */
  async grant(playerId: string, itemId: string, spend: Wallet): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const debited = await tx.player.updateMany({
        where: {
          id: playerId,
          softCurrency: { gte: spend.soft },
          hardCurrency: { gte: spend.hard },
        },
        data: {
          softCurrency: { decrement: spend.soft },
          hardCurrency: { decrement: spend.hard },
        },
      });
      if (debited.count === 0) throw new PurchaseConflictError();

      // Apres le debit : un objet accorde sans paiement est pire qu'un
      // paiement sans objet, qui lui se rembourse.
      await tx.inventoryItem.create({ data: { playerId, itemId, source: 'shop' } });
    });
  }

  async setLoadout(playerId: string, data: LoadoutData): Promise<void> {
    await this.prisma.loadout.upsert({
      where: { playerId },
      create: { playerId, data: data },
      update: { data: data },
    });
  }
}
