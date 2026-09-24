import type {
  InventoryChanges,
  InventoryRepository,
  LoadoutData,
} from '../../inventory/domain/ports.js';
import { ownedWithFree } from '../../inventory/domain/purchase.js';
import type { AppLog } from '../../../shared/log-port.js';
import { describeCause } from '../../../shared/describe-cause.js';
import type { PlayerWardrobe } from '../domain/wardrobe.js';
import type { SeatWearing } from './match-runtime.js';

/**
 * Ce que porte un joueur, vu par le match : de l'inventaire a `SeatWearing`.
 *
 * **On ne porte que ce qu'on possede.** L'inventaire l'impose a l'ecriture ; on
 * le rejoue ici parce qu'un objet peut avoir quitte le catalogue depuis — et
 * que ce qui sort d'ici part chez l'ADVERSAIRE, dans `match:found`.
 */
export function wearingFrom(owned: readonly string[], loadout: LoadoutData | null): SeatWearing {
  const has = new Set(owned);
  const kept = (id: string | undefined): string | undefined =>
    id !== undefined && has.has(id) ? id : undefined;

  const dances: Record<string, string> = {};
  for (const [key, id] of Object.entries(loadout?.dances ?? {})) {
    if (has.has(id)) dances[key] = id;
  }

  // Recopie champ par champ : un emplacement ajoute un jour a l'inventaire ne
  // doit pas arriver chez l'adversaire sans qu'on l'ait decide ici.
  const look: Record<string, string> = {};
  const slots = {
    outfit: kept(loadout?.outfit),
    hair: kept(loadout?.hair),
    auraColor: kept(loadout?.auraColor),
    signature: kept(loadout?.signature),
  };
  for (const [slot, id] of Object.entries(slots)) {
    if (id !== undefined) look[slot] = id;
  }

  return { ownedEffects: owned, dances, look };
}

/**
 * Ce que porte un joueur, lu dans l'inventaire.
 *
 * Les objets offerts comptent comme possedes : ils ne sont jamais ecrits en
 * base. Les oublier retirait de l'apparence annoncee la tenue, la couleur et
 * la danse signature de quiconque n'avait rien achete — c'est-a-dire de
 * presque tout le monde.
 */
export function wardrobeFromInventory(
  inventory: Pick<InventoryRepository, 'read' | 'catalogue'>,
): PlayerWardrobe {
  return {
    async wearingOf(playerId: string): Promise<SeatWearing> {
      const [{ owned, loadout }, catalogue] = await Promise.all([
        inventory.read(playerId),
        inventory.catalogue(),
      ]);
      return wearingFrom(ownedWithFree(owned, catalogue), loadout);
    },
  };
}

/** Le registre des sessions, vu d'ici : ce que le prochain match copiera. */
export interface WearingPresence {
  setWearing(playerId: string, wearing: SeatWearing): void;
}

/** Le match en cours, vu d'ici : seules ses danses par mouvement suivent. */
export interface WearingRuntime {
  refreshDances(playerId: string, dances: Readonly<Record<string, string>>): void;
}

/**
 * L'ecoute des changements d'inventaire, cote match.
 *
 * Le match lisait l'apparence **une fois, a la connexion**. La socket vit d'un
 * duel a l'autre : une danse equipee au vestiaire n'etait donc vue par
 * l'adversaire qu'apres une reconnexion, et une danse choisie en plein duel,
 * jamais.
 *
 * Ne leve jamais : l'equipement est deja enregistre quand on arrive ici, et un
 * rafraichissement manque ne doit pas le faire passer pour refuse. Le prochain
 * branchement relira l'inventaire de toute facon.
 */
export class WearingRefresh implements InventoryChanges {
  constructor(
    private readonly wardrobe: PlayerWardrobe,
    private readonly presence: WearingPresence,
    private readonly runtime: WearingRuntime,
    private readonly log: AppLog | null = null,
  ) {}

  async changed(playerId: string): Promise<void> {
    try {
      const wearing = await this.wardrobe.wearingOf(playerId);
      this.presence.setWearing(playerId, wearing);
      this.runtime.refreshDances(playerId, wearing.dances);
    } catch (cause) {
      this.log?.warn(`apparence non rafraichie pour ${playerId} : ${describeCause(cause)}`);
    }
  }
}
