import { dayIndexOf } from '@aura/content';
import {
  ownedWithFree,
  purchaseOutcome,
  type CatalogueEntry,
  type PurchaseRefusal,
} from '../domain/purchase.js';
import { fitsDanceSlot, fitsLookSlot, fitsSignature, lookEntries } from '../domain/slots.js';
import type {
  Clock,
  InventoryChanges,
  InventoryRepository,
  LoadoutData,
  PlayerInventory,
} from '../domain/ports.js';

/**
 * L'inventaire du joueur : ce qu'il possede, ce qu'il achete, ce qu'il porte.
 *
 * Il vit sur le SERVEUR, et c'est tout l'interet. L'inventaire a longtemps
 * tenu dans le stockage du navigateur : un inventaire qu'on s'offre soi-meme,
 * perdu en changeant d'appareil. Avec le code de recuperation, garder son
 * compte sans garder ses achats n'avait plus de sens.
 */

export type InventoryFailure = PurchaseRefusal | 'UNKNOWN_ITEM' | 'NOT_OWNED' | 'WRONG_SLOT';

export class InventoryError extends Error {
  constructor(readonly reason: InventoryFailure) {
    super(reason);
    this.name = 'InventoryError';
  }
}

export interface InventoryDependencies {
  readonly inventory: InventoryRepository;
  readonly clock: Clock;
  /** Qui doit apprendre qu'un inventaire a change. Absent : personne. */
  readonly changes?: InventoryChanges;
}

export class InventoryService {
  constructor(private readonly deps: InventoryDependencies) {}

  /**
   * Ce que le joueur possede, les objets offerts compris.
   *
   * **Ce qui est offert appartient a tout le monde** (`isOffered` : rarete
   * par defaut, prix nul, sans condition), et n'est jamais ecrit. Les accorder un par un demanderait au joueur de « payer » zero pour
   * chaque couleur offerte, et remplirait la table d'autant de lignes qui ne
   * disent rien.
   */
  async read(playerId: string): Promise<PlayerInventory> {
    return (await this.load(playerId)).inventory;
  }

  /** L'inventaire, offerts compris, et le catalogue qui a servi a le calculer. */
  private async load(
    playerId: string,
  ): Promise<{ inventory: PlayerInventory; catalogue: readonly CatalogueEntry[] }> {
    const [stored, catalogue] = await Promise.all([
      this.deps.inventory.read(playerId),
      this.deps.inventory.catalogue(),
    ]);
    return { inventory: { ...stored, owned: ownedWithFree(stored.owned, catalogue) }, catalogue };
  }

  async buy(playerId: string, itemId: string): Promise<void> {
    const { inventory, catalogue } = await this.load(playerId);

    const item = catalogue.find((entry) => entry.id === itemId);
    if (item === undefined) throw new InventoryError('UNKNOWN_ITEM');

    const now = this.deps.clock.now();
    const outcome = purchaseOutcome({
      item,
      wallet: inventory.wallet,
      owned: inventory.owned.includes(itemId),
      now,
      /*
        Le jour vient de l'horloge du SERVEUR, jamais de la requete.

        C'est lui qui decide de la remise : un client qui enverrait son propre
        numero de jour achèterait tout a moins trente pour cent en choisissant
        bien. Regle d'or n°1 — le client n'envoie que des intentions.
      */
      day: dayIndexOf(now.getTime()),
    });
    if (!outcome.ok) throw new InventoryError(outcome.reason);

    try {
      await this.deps.inventory.grant(playerId, itemId, outcome.spend);
    } catch {
      /*
        La base a refuse : un autre appel a accorde le meme objet entre notre
        lecture et notre ecriture. Deux onglets ouverts suffisent.

        Le perdant repart avec « tu le possedes deja » — ce qui est vrai — et
        surtout **sans second debit**. Traduire ca en erreur serveur ferait
        payer deux fois quelqu'un qui a seulement double-clique.
      */
      throw new InventoryError('ALREADY_OWNED');
    }
    // Posseder un effet d'aura, c'est le porter a son niveau : le match doit
    // l'apprendre avant la prochaine revelation, pas a la prochaine connexion.
    await this.deps.changes?.changed(playerId);
  }

  /**
   * Enregistre ce que le joueur porte.
   *
   * **On ne porte que ce qu'on possede.** Sans cette garde, l'ecran de
   * vestiaire d'un client modifie devient la boutique entiere, gratuite.
   */
  async equip(playerId: string, data: LoadoutData): Promise<void> {
    const { inventory, catalogue } = await this.load(playerId);
    const owned = new Set(inventory.owned);

    const worn = [
      data.outfit,
      data.hair,
      data.auraColor,
      data.auraEffect,
      ...Object.values(data.dances ?? {}),
    ];
    for (const id of [...worn, data.signature]) {
      if (id !== undefined && !owned.has(id)) throw new InventoryError('NOT_OWNED');
    }

    /*
      Chaque emplacement a SON kind : une danse rangee sous `auraColor`
      partait telle quelle chez l'adversaire, dans `opponent.cosmetics`.
      Meme regle que la lecture du match (`wearingFrom`), dans `slots.ts`.
    */
    const kinds = new Map(catalogue.map((item) => [item.id, item.kind]));
    for (const [slot, id] of lookEntries(data)) {
      if (!fitsLookSlot(slot, id, (candidate) => kinds.get(candidate))) {
        throw new InventoryError('WRONG_SLOT');
      }
    }
    for (const [key, id] of Object.entries(data.dances ?? {})) {
      if (!fitsDanceSlot(key, id)) throw new InventoryError('WRONG_SLOT');
    }
    if (data.signature !== undefined && !fitsSignature(data.signature)) {
      throw new InventoryError('WRONG_SLOT');
    }

    await this.deps.inventory.setLoadout(playerId, data);
    await this.deps.changes?.changed(playerId);
  }
}
