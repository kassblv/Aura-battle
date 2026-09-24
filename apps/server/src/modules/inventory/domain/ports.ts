import type { CatalogueEntry, Wallet } from './purchase.js';

/**
 * Ports de l'inventaire (architecture hexagonale, docs/02).
 *
 * Le service ne connait ni Prisma ni l'horloge : il les recoit. C'est ce qui
 * permet de tester une course entre deux achats sans base de donnees.
 */

/** Ce que le joueur porte, par emplacement. Toutes les cles sont facultatives. */
export interface LoadoutData {
  readonly outfit?: string;
  readonly hair?: string;
  readonly auraColor?: string;
  /** L'effet d'aura, enfin equipable : `AURA_STYLES` attendait un porteur. */
  readonly auraEffect?: string;
  /** Danse par mouvement, indexee `<style>.t<palier>`. */
  readonly dances?: Readonly<Record<string, string>>;
  /** Danse signature, jouee a la victoire et vue par l'adversaire. */
  readonly signature?: string;
}

export interface PlayerInventory {
  readonly wallet: Wallet;
  readonly owned: readonly string[];
  readonly loadout: LoadoutData | null;
}

export interface InventoryRepository {
  catalogue(): Promise<readonly CatalogueEntry[]>;
  read(playerId: string): Promise<PlayerInventory>;
  /**
   * Accorde l'objet et debite, **en une transaction**.
   *
   * Rejette si le joueur possede deja l'objet : c'est la cle primaire
   * `(playerId, itemId)` qui tranche, et elle seule peut le faire — entre la
   * lecture de la regle et l'ecriture, un autre onglet a pu passer.
   */
  grant(playerId: string, itemId: string, spend: Wallet): Promise<void>;
  setLoadout(playerId: string, data: LoadoutData): Promise<void>;
}

/**
 * Qui doit apprendre qu'un inventaire a change.
 *
 * Le module `match` lit ce que porte un joueur a sa connexion ; sans ce
 * signal, une danse equipee au vestiaire n'etait vue par l'adversaire qu'apres
 * une reconnexion, et une danse choisie en plein duel, jamais.
 *
 * Attendu avant de repondre : quand le client recoit sa reponse, le match sait
 * deja. L'implementation ne doit pas echouer — l'equipement est enregistre, et
 * un signal perdu ne doit pas le faire passer pour refuse.
 */
export interface InventoryChanges {
  changed(playerId: string): Promise<void>;
}

/** Jeton d'injection du signal. */
export const INVENTORY_CHANGES = 'INVENTORY_CHANGES';

/** L'horloge est un port : le temps est une entree, pas une globale. */
export interface Clock {
  now(): Date;
}
