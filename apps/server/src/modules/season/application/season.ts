import { seasonTierFor } from '@aura/content';
import type { SeasonState } from '@aura/protocol';
import type { InventoryChanges, InventoryRepository } from '../../inventory/domain/ports.js';
import { ownedWithFree } from '../../inventory/domain/purchase.js';
import {
  claimAll,
  claimOutcome,
  premiumOutcome,
  type ClaimKey,
  type SeasonGrant,
} from '../domain/claim.js';
import {
  SeasonConflictError,
  type Clock,
  type CurrentSeason,
  type SeasonFailure,
  type SeasonRepository,
} from '../domain/ports.js';

/**
 * Le passe de saison, cote application.
 *
 * Il assemble le CONTENU (`SEASON_PASS`), la REGLE (`domain/claim.ts`, pure)
 * et la BASE (deux ports). Le serveur seul juge l'XP, les paliers, la piste
 * premium et ce qui est deja reclame : le client ne dit que « ce palier, cette
 * piste » (regle d'or n°1).
 *
 * Chaque route rend l'etat complet, relu APRES l'ecriture : l'ecran n'a rien a
 * recalculer, donc rien a faire diverger.
 */

export class SeasonError extends Error {
  constructor(readonly reason: SeasonFailure) {
    super(reason);
    this.name = 'SeasonError';
  }
}

export interface SeasonDependencies {
  readonly seasons: SeasonRepository;
  /** La bourse, ce qui est possede et le catalogue : ceux de l'inventaire. */
  readonly inventory: Pick<InventoryRepository, 'catalogue' | 'read'>;
  readonly clock: Clock;
  /** Qui doit apprendre qu'un cosmetique a ete accorde. Absent : personne. */
  readonly changes?: InventoryChanges;
  /** Ou dire qu'un signal au match a echoue apres une reclamation ecrite. */
  readonly warn?: (message: string) => void;
}

export class SeasonService {
  constructor(private readonly deps: SeasonDependencies) {}

  async state(playerId: string): Promise<SeasonState> {
    return (await this.load(playerId)).state;
  }

  /** Reclame une recompense, et rend l'etat qui en resulte. */
  async claim(playerId: string, key: ClaimKey): Promise<SeasonState> {
    const { season, context } = await this.requireSeason(playerId);
    const outcome = claimOutcome(key, context);
    if (!outcome.ok) throw new SeasonError(outcome.reason);
    await this.write(playerId, season, [outcome.grant]);
    return this.state(playerId);
  }

  /**
   * « Tout recuperer », en UNE transaction.
   *
   * Une reclamation d'un autre onglet peut passer entre la lecture et
   * l'ecriture : la cle primaire refuse alors tout le lot. On relit et on
   * recommence une fois — ce qui restait a prendre est toujours a prendre.
   */
  async claimAll(playerId: string): Promise<SeasonState> {
    for (let attempt = 0; ; attempt += 1) {
      const { season, context } = await this.requireSeason(playerId);
      const grants = claimAll(context);
      if (grants.length === 0) return this.state(playerId);
      try {
        await this.write(playerId, season, grants);
        return await this.state(playerId);
      } catch (cause) {
        const raced = cause instanceof SeasonError && cause.reason === 'ALREADY_CLAIMED';
        if (attempt > 0 || !raced) throw cause;
      }
    }
  }

  /** Achete la piste premium, en jetons. */
  async buyPremium(playerId: string): Promise<SeasonState> {
    const { season, context, wallet } = await this.requireSeason(playerId);
    const outcome = premiumOutcome({ wallet, premium: context.premium });
    if (!outcome.ok) throw new SeasonError(outcome.reason);
    try {
      await this.deps.seasons.buyPremium(playerId, season.id, outcome.spend.hard);
    } catch (cause) {
      if (cause instanceof SeasonConflictError) throw new SeasonError(cause.reason);
      throw cause;
    }
    return this.state(playerId);
  }

  private async write(
    playerId: string,
    season: CurrentSeason,
    grants: readonly SeasonGrant[],
  ): Promise<void> {
    try {
      await this.deps.seasons.grant(playerId, season.id, grants);
    } catch (cause) {
      if (cause instanceof SeasonConflictError) throw new SeasonError(cause.reason);
      throw cause;
    }
    /*
      Un cosmetique accorde : le match doit l'apprendre, comme apres un achat.
      Posseder un effet d'aura, c'est le porter a son niveau — sans ce signal,
      il ne compterait qu'a la prochaine connexion.
    */
    if (this.deps.changes !== undefined && grants.some((grant) => grant.itemId !== null)) {
      /*
        La reclamation est deja ECRITE : un echec ici ne doit pas la faire lire
        comme refusee — le nouvel essai du joueur tomberait sur « deja
        reclame ». Le match l'apprendra a la prochaine connexion.
      */
      try {
        const [stored, catalogue] = await Promise.all([
          this.deps.inventory.read(playerId),
          this.deps.inventory.catalogue(),
        ]);
        await this.deps.changes.changed(playerId, {
          owned: ownedWithFree(stored.owned, catalogue),
          loadout: stored.loadout,
        });
      } catch (cause) {
        this.deps.warn?.(
          `signal au match apres une reclamation de saison en echec : ${cause instanceof Error ? cause.name : 'inconnu'}`,
        );
      }
    }
  }

  private async requireSeason(playerId: string) {
    const loaded = await this.load(playerId);
    if (loaded.season === null) throw new SeasonError('NO_SEASON');
    return { ...loaded, season: loaded.season };
  }

  /** Une seule lecture d'horloge par operation. */
  private async load(playerId: string) {
    const season = await this.deps.seasons.current(this.deps.clock.now().getTime());
    const [progress, inventory, catalogue] = await Promise.all([
      season === null
        ? Promise.resolve({ xp: 0, premium: false, claimed: [] })
        : this.deps.seasons.progress(playerId, season.id),
      this.deps.inventory.read(playerId),
      this.deps.inventory.catalogue(),
    ]);

    const state: SeasonState = {
      season:
        season === null ? null : { number: season.number, endsAt: season.endsAt.toISOString() },
      xp: progress.xp,
      tier: seasonTierFor(progress.xp),
      premium: progress.premium,
      claimed: progress.claimed.map((key) => ({ tier: key.tier, track: key.track })),
      wallet: inventory.wallet,
    };
    return {
      season,
      state,
      wallet: inventory.wallet,
      context: {
        xp: progress.xp,
        premium: progress.premium,
        claimed: progress.claimed,
        owned: inventory.owned,
        catalogue,
      },
    };
  }
}
