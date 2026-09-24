import { dayIndexOf } from '@aura/content';
import {
  ownedWithFree,
  purchaseOutcome,
  type CatalogueEntry,
  type PurchaseRefusal,
} from '../domain/purchase.js';
import { describeErrorKind } from '../../../shared/describe-cause.js';
import { KeyedSerializer } from '../../../shared/keyed-serializer.js';
import type { AppLog } from '../../../shared/log-port.js';
import { fitsDanceSlot, fitsLookSlot, fitsSignature, lookEntries } from '../domain/slots.js';
import {
  PurchaseConflictError,
  type Clock,
  type InventoryChanges,
  type InventoryRepository,
  type LoadoutData,
  type PlayerInventory,
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
  /** Ou signaler une panne de la base pendant un achat. Absent : nulle part. */
  readonly log?: AppLog;
}

/**
 * Les bornes de la file des ecritures d'un joueur (`KeyedSerializer`).
 *
 * - **Profondeur : 4.** Achat et equipement partagent la file. Un joueur qui
 *   passe ses couleurs en revue au vestiaire touche jusqu'a quatre fois par
 *   seconde, et chaque ecriture se vide en quelques millisecondes : la file
 *   depasse rarement une ou deux entrees. Quatre en attente, c'est donc deja
 *   une base qui ne suit plus — et le joueur qui insiste (environ trois
 *   essais par seconde) ne fait plus que l'allonger. La cinquieme est
 *   refusee aussitot, en 429 `RATE_LIMITED`, que le client connait deja.
 * - **Delai : 60 s.** Passe ce delai depuis son debut, une ecriture cede la
 *   file meme si elle n'a pas abouti. Il doit depasser la plus longue
 *   ecriture qui peut ENCORE reussir, sans quoi on relacherait l'ordre
 *   derriere un achat sur le point d'aboutir : un achat, c'est au pire une
 *   lecture, la transaction (`PURCHASE_TRANSACTION`, 2 s + 5 s) et le signal
 *   au match ; un equipement, trois requetes. Chaque requete tient dans
 *   `WORST_QUERY_MS` (17 s) : 41 s pour l'achat, 51 s pour l'equipement.
 *   Au-dela, l'ecriture a forcement echoue ou reussi. Ce delai n'est qu'un
 *   filet : les delais du bassin (`DATABASE_TIMEOUTS`) font deja echouer une
 *   requete pendante bien avant lui.
 */
export const INVENTORY_WRITE_QUEUE = Object.freeze({ maxDepth: 4, releaseAfterMs: 60_000 });

export class InventoryService {
  constructor(private readonly deps: InventoryDependencies) {
    this.writes = new KeyedSerializer({
      ...INVENTORY_WRITE_QUEUE,
      // Le joueur n'est pas nomme : le signal dit que la base ne suit plus,
      // pas qui attendait.
      onOverdue: () =>
        this.deps.log?.warn(
          `ecriture d inventaire sans reponse apres ${String(INVENTORY_WRITE_QUEUE.releaseAfterMs)} ms : file relachee`,
        ),
    });
  }

  /**
   * Les ecritures d'un meme joueur, l'une apres l'autre.
   *
   * Chaque ecriture lit l'inventaire, ecrit, puis previent le match avec
   * l'etat obtenu. Deux ecritures simultanees — deux touchers rapides au
   * vestiaire, un achat suivi d'un equipement — le faisaient sans ordre : le
   * match pouvait finir sur l'avant-dernier loadout, ou perdre de
   * `ownedEffects` l'effet tout juste achete, parce que l'equipement avait lu
   * avant l'achat. En file, chaque ecriture lit ce que la precedente a ecrit,
   * et le dernier signal recu par le match est celui de la derniere ecriture.
   *
   * Une file pleine rejette par `KeyedSerializerFullError` ; c'est au
   * controleur d'en faire un 429.
   *
   * Un exemplaire par service, donc par processus (ADR 0012). Les lectures
   * n'y passent pas : elles ne previennent personne.
   */
  private readonly writes: KeyedSerializer;

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

  /**
   * Achete un objet, et rend l'inventaire qui en resulte.
   *
   * Rendu plutot que relu : la bourse vient de la transaction du debit, la
   * liste des possessions de la lecture qui a servi a juger l'achat.
   */
  buy(playerId: string, itemId: string): Promise<PlayerInventory> {
    return this.writes.run(playerId, () => this.buyNow(playerId, itemId));
  }

  private async buyNow(playerId: string, itemId: string): Promise<PlayerInventory> {
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

    let wallet;
    try {
      wallet = await this.deps.inventory.grant(playerId, itemId, outcome.spend);
    } catch (cause) {
      /*
        La base a refuse, avec SA raison : un autre appel a accorde le meme
        objet entre notre lecture et notre ecriture (ALREADY_OWNED), ou la
        bourse ne couvre plus le prix (INSUFFICIENT_FUNDS). Les ecritures d'un
        joueur passent en file, mais un credit ou un accord venu d'ailleurs
        (fin de match, defi) peut toujours se glisser entre les deux.

        Le perdant repart avec la vraie raison, et surtout **sans debit** : la
        transaction a tout annule.
      */
      if (cause instanceof PurchaseConflictError) throw new InventoryError(cause.reason);
      /*
        Tout le reste est une PANNE. La deguiser en « deja possede » la
        rendait invisible ; relancee, elle devient un 500 et se voit. Le
        journal n'en garde que le nom et le code : le message d'une erreur
        Prisma recopie les arguments refuses.
      */
      this.deps.log?.warn(`achat : accord impossible (${describeErrorKind(cause)})`);
      throw cause;
    }
    const after: PlayerInventory = {
      wallet,
      owned: [...inventory.owned, itemId],
      loadout: inventory.loadout,
    };
    // Posseder un effet d'aura, c'est le porter a son niveau : le match doit
    // l'apprendre avant la prochaine revelation, pas a la prochaine connexion.
    await this.deps.changes?.changed(playerId, after);
    return after;
  }

  /**
   * Enregistre ce que le joueur porte.
   *
   * **On ne porte que ce qu'on possede.** Sans cette garde, l'ecran de
   * vestiaire d'un client modifie devient la boutique entiere, gratuite.
   *
   * Rend l'inventaire enregistre : c'est la reponse de la route, et le signal
   * au match. Une seule lecture pour les trois.
   */
  equip(playerId: string, data: LoadoutData): Promise<PlayerInventory> {
    return this.writes.run(playerId, () => this.equipNow(playerId, data));
  }

  private async equipNow(playerId: string, data: LoadoutData): Promise<PlayerInventory> {
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
    const after: PlayerInventory = { ...inventory, loadout: data };
    await this.deps.changes?.changed(playerId, after);
    return after;
  }
}
