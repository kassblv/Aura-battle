import type {
  InventoryChanges,
  InventoryRepository,
  InventorySnapshot,
  LoadoutData,
} from '../../inventory/domain/ports.js';
import type { CosmeticKind } from '@prisma/client';
import { ownedWithFree } from '../../inventory/domain/purchase.js';
import {
  fitsDanceSlot,
  fitsLookSlot,
  fitsSignature,
  lookEntries,
} from '../../inventory/domain/slots.js';
import type { AppLog } from '../../../shared/log-port.js';
import { describeCause } from '../../../shared/describe-cause.js';
import type { PlayerWardrobe } from '../domain/wardrobe.js';
import type { SeatWearing } from './match-runtime.js';

/**
 * Ce que porte un joueur, vu par le match : de l'inventaire a `SeatWearing`.
 *
 * **On ne porte que ce qu'on possede, a sa place.** L'inventaire l'impose a
 * l'ecriture ; on le rejoue ici parce qu'un objet peut avoir quitte le
 * catalogue depuis, qu'un loadout ecrit avant le controle des emplacements
 * peut ranger une danse en couleur d'aura ou un palier 4 sous `calme.t0` — et
 * que ce qui sort d'ici part chez l'ADVERSAIRE, dans `match:found`.
 *
 * @param kinds le kind de chaque objet du catalogue : un objet inconnu n'est
 *   annonce nulle part.
 */
export function wearingFrom(
  owned: readonly string[],
  loadout: LoadoutData | null,
  kinds: ReadonlyMap<string, CosmeticKind>,
): SeatWearing {
  const has = new Set(owned);
  const kindOf = (id: string): CosmeticKind | undefined => kinds.get(id);

  const dances: Record<string, string> = {};
  for (const [key, id] of Object.entries(loadout?.dances ?? {})) {
    if (has.has(id) && fitsDanceSlot(key, id)) dances[key] = id;
  }

  // Recopie emplacement par emplacement : un emplacement ajoute un jour a
  // l'inventaire ne doit pas arriver chez l'adversaire sans qu'on l'ait decide
  // ici. L'effet d'aura n'en fait pas partie — il se joue par niveau, a la
  // revelation, depuis `ownedEffects`.
  const look: Record<string, string> = {};
  for (const [slot, id] of lookEntries(loadout)) {
    if (slot !== 'auraEffect' && has.has(id) && fitsLookSlot(slot, id, kindOf)) look[slot] = id;
  }
  const signature = loadout?.signature;
  if (signature !== undefined && has.has(signature) && fitsSignature(signature)) {
    look.signature = signature;
  }

  return { ownedEffects: owned, dances, look };
}

/** Ce que porte un joueur, calcule a partir d'un etat d'inventaire deja lu. */
export interface WearingSource {
  wearingFor(snapshot: InventorySnapshot): Promise<SeatWearing>;
}

/**
 * Ce que porte un joueur, lu dans l'inventaire.
 *
 * Les objets offerts comptent comme possedes : ils ne sont jamais ecrits en
 * base. Les oublier retirait de l'apparence annoncee la tenue, la couleur et
 * la danse signature de quiconque n'avait rien achete — c'est-a-dire de
 * presque tout le monde.
 *
 * `wearingFor` part d'un etat deja lu (celui que l'inventaire vient
 * d'ecrire) et ne lit que le catalogue, garde en memoire par l'adaptateur.
 */
export function wardrobeFromInventory(
  inventory: Pick<InventoryRepository, 'read' | 'catalogue'>,
): PlayerWardrobe & WearingSource {
  const wearingFor = async ({ owned, loadout }: InventorySnapshot): Promise<SeatWearing> => {
    const catalogue = await inventory.catalogue();
    return wearingFrom(
      ownedWithFree(owned, catalogue),
      loadout,
      new Map(catalogue.map((item) => [item.id, item.kind])),
    );
  };
  return {
    async wearingOf(playerId: string): Promise<SeatWearing> {
      return wearingFor(await inventory.read(playerId));
    },
    wearingFor,
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
 *
 * Ne relit pas l'inventaire : le signal porte l'etat qui vient d'etre ecrit.
 */
export class WearingRefresh implements InventoryChanges {
  constructor(
    private readonly wardrobe: WearingSource,
    private readonly presence: WearingPresence,
    private readonly runtime: WearingRuntime,
    private readonly log: AppLog | null = null,
  ) {}

  async changed(playerId: string, snapshot: InventorySnapshot): Promise<void> {
    try {
      const wearing = await this.wardrobe.wearingFor(snapshot);
      this.presence.setWearing(playerId, wearing);
      this.runtime.refreshDances(playerId, wearing.dances);
    } catch (cause) {
      this.log?.warn(`apparence non rafraichie pour ${playerId} : ${describeCause(cause)}`);
    }
  }
}
