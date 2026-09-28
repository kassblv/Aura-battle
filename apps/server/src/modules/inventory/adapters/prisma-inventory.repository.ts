import { Inject, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PURCHASE_TRANSACTION } from '../../../shared/database-timeouts.js';
import { PrismaService } from '../../../shared/prisma.service.js';
import {
  PurchaseConflictError,
  type InventoryRepository,
  type LoadoutData,
  type PlayerInventory,
} from '../domain/ports.js';
import type { CatalogueEntry, Wallet } from '../domain/purchase.js';

@Injectable()
export class PrismaInventoryRepository implements InventoryRepository {
  // Jeton explicite : esbuild n'emet pas `design:paramtypes` (voir auth.controller.ts).
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  /** Le catalogue lu, partage par tous les appels : voir `catalogue()`. */
  private cachedCatalogue: Promise<readonly CatalogueEntry[]> | null = null;

  /**
   * Le catalogue, lu une fois par processus.
   *
   * Il ne change qu'au seed, et le seed tourne AVANT le serveur, a chaque
   * demarrage (`docker/entrypoint.sh`). Le relire a chaque equipement coutait
   * une requete par appel pour une reponse toujours identique. On garde la
   * PROMESSE : deux appels simultanes au demarrage ne lisent qu'une fois.
   *
   * Un echec n'est pas garde, sinon une base indisponible une seconde au
   * demarrage laisserait la boutique vide jusqu'au deploiement suivant.
   *
   * En developpement, relancer le seed a chaud demande de redemarrer
   * `pnpm dev` — comme une migration (voir CLAUDE.md, Prisma 7).
   */
  catalogue(): Promise<readonly CatalogueEntry[]> {
    this.cachedCatalogue ??= this.readCatalogue().catch((cause: unknown) => {
      this.cachedCatalogue = null;
      throw cause;
    });
    return this.cachedCatalogue;
  }

  private async readCatalogue(): Promise<readonly CatalogueEntry[]> {
    return this.prisma.cosmeticItem.findMany({
      select: {
        id: true,
        kind: true,
        rarity: true,
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
   *
   * Chaque garde a SA raison : le debit refuse, c'est une bourse a sec ;
   * l'unicite violee (`P2002`), un objet deja possede. Tout le reste est une
   * panne, et remonte tel quel.
   */
  async grant(playerId: string, itemId: string, spend: Wallet): Promise<Wallet> {
    try {
      return await this.grantInTransaction(playerId, itemId, spend);
    } catch (cause) {
      if (cause instanceof Prisma.PrismaClientKnownRequestError && cause.code === 'P2002') {
        throw new PurchaseConflictError('ALREADY_OWNED', cause);
      }
      throw cause;
    }
  }

  private grantInTransaction(playerId: string, itemId: string, spend: Wallet): Promise<Wallet> {
    return this.prisma.$transaction(async (tx) => {
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
      if (debited.count === 0) throw new PurchaseConflictError('INSUFFICIENT_FUNDS');

      // Apres le debit : un objet accorde sans paiement est pire qu'un
      // paiement sans objet, qui lui se rembourse.
      await tx.inventoryItem.create({ data: { playerId, itemId, source: 'shop' } });

      // La bourse apres debit, dans la transaction : la ligne est verrouillee
      // par la mise a jour, rien n'a pu la toucher entre-temps.
      const after = await tx.player.findUniqueOrThrow({
        where: { id: playerId },
        select: { softCurrency: true, hardCurrency: true },
      });
      return { soft: after.softCurrency, hard: after.hardCurrency };
    }, PURCHASE_TRANSACTION);
  }

  async setLoadout(playerId: string, data: LoadoutData): Promise<void> {
    /*
      Recopie dans un objet nu, et non une assertion de type.

      `LoadoutData` n'a pas de signature d'index, donc Prisma le refuse la ou
      il attend du JSON. Une assertion ferait taire le compilateur — et ESLint
      la retire aussitot, la jugeant inutile : les deux outils se
      contredisaient a chaque `lint:fix`. La recopie est ce que Prisma veut
      vraiment, et elle n'a besoin d'etre expliquee qu'une fois.
    */
    const payload = { ...data };
    await this.prisma.loadout.upsert({
      where: { playerId },
      create: { playerId, data: payload },
      update: { data: payload },
    });
  }
}
