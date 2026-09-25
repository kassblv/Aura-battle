import type { SeasonTrack } from '@aura/content';
import { Inject, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { currentSeason } from '../../../shared/current-season.js';
import { PURCHASE_TRANSACTION } from '../../../shared/database-timeouts.js';
import { PrismaService } from '../../../shared/prisma.service.js';
import type { SeasonGrant } from '../domain/claim.js';
import {
  SeasonConflictError,
  type CurrentSeason,
  type SeasonProgress,
  type SeasonRepository,
} from '../domain/ports.js';

const isTrack = (track: string): track is SeasonTrack => track === 'free' || track === 'premium';

@Injectable()
export class PrismaSeasonRepository implements SeasonRepository {
  // Jeton explicite : esbuild n'emet pas `design:paramtypes` (voir CLAUDE.md).
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  /** La meme requete que le classement : jamais deux saisons pour un instant. */
  current(nowMs: number): Promise<CurrentSeason | null> {
    return currentSeason(this.prisma, nowMs);
  }

  async progress(playerId: string, seasonId: string): Promise<SeasonProgress> {
    const [row, claims] = await Promise.all([
      this.prisma.seasonProgress.findUnique({
        where: { playerId_seasonId: { playerId, seasonId } },
        select: { xp: true, premiumAt: true },
      }),
      this.prisma.seasonClaim.findMany({
        where: { playerId, seasonId },
        select: { tier: true, track: true },
        orderBy: [{ tier: 'asc' }, { track: 'asc' }],
      }),
    ]);
    return {
      xp: row?.xp ?? 0,
      premium: row?.premiumAt != null,
      // La contrainte CHECK de la migration garantit deja la piste ; le filtre
      // garde le type honnete sans assertion.
      claimed: claims.flatMap((c) => (isTrack(c.track) ? [{ tier: c.tier, track: c.track }] : [])),
    };
  }

  /**
   * Inscrit PUIS credite, en une transaction — le motif « marquer puis payer »
   * des defis quotidiens.
   *
   * L'insertion de `SeasonClaim` vient en premier : sa cle primaire est la
   * garde contre la double reclamation, et une violation (`P2002`) annule la
   * transaction avant le moindre credit. Un paiement en double ne se
   * remarquerait jamais ; une reclamation refusee a tort se reessaie.
   *
   * Un cosmetique s'insere sans erreur s'il est deja possede
   * (`skipDuplicates`) : la ligne non ecrite se compte, et le joueur recoit
   * ses pieces a la place. Une recompense n'est jamais vide.
   */
  async grant(playerId: string, seasonId: string, grants: readonly SeasonGrant[]): Promise<void> {
    if (grants.length === 0) return;
    try {
      await this.prisma.$transaction(async (tx) => {
        await tx.seasonClaim.createMany({
          data: grants.map((grant) => ({
            playerId,
            seasonId,
            tier: grant.tier,
            track: grant.track,
          })),
        });

        let soft = 0;
        let hard = 0;
        for (const grant of grants) {
          soft += grant.coins;
          hard += grant.tokens;
          if (grant.itemId === null) continue;
          const created = await tx.inventoryItem.createMany({
            data: [{ playerId, itemId: grant.itemId, source: 'pass' }],
            skipDuplicates: true,
          });
          if (created.count === 0) soft += grant.fallbackCoins;
        }

        if (soft > 0 || hard > 0) {
          await tx.player.update({
            where: { id: playerId },
            data: { softCurrency: { increment: soft }, hardCurrency: { increment: hard } },
            select: { id: true },
          });
        }
      }, PURCHASE_TRANSACTION);
    } catch (cause) {
      if (cause instanceof Prisma.PrismaClientKnownRequestError && cause.code === 'P2002') {
        throw new SeasonConflictError('ALREADY_CLAIMED', cause);
      }
      throw cause;
    }
  }

  /**
   * La piste premium et son debit, en une transaction.
   *
   * La piste d'abord, conditionnee a `premiumAt` nul : deux achats simultanes,
   * et le second trouve la ligne deja marquee (et verrouillee jusqu'a la fin
   * du premier). Le debit ensuite, conditionne a une bourse qui couvre le
   * prix, comme l'achat en boutique : sans ce `WHERE`, un achat en boutique
   * passe entre la lecture et l'ecriture mettrait la bourse dans le negatif.
   * Un refus leve, et la levee annule tout.
   */
  async buyPremium(playerId: string, seasonId: string, price: number): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      // La ligne existe des le premier match de la saison ; un joueur qui
      // achete avant d'avoir joue n'en a pas encore.
      await tx.seasonProgress.upsert({
        where: { playerId_seasonId: { playerId, seasonId } },
        create: { playerId, seasonId },
        update: {},
        select: { xp: true },
      });

      const opened = await tx.seasonProgress.updateMany({
        where: { playerId, seasonId, premiumAt: null },
        data: { premiumAt: new Date() },
      });
      if (opened.count === 0) throw new SeasonConflictError('ALREADY_PREMIUM');

      const debited = await tx.player.updateMany({
        where: { id: playerId, hardCurrency: { gte: price } },
        data: { hardCurrency: { decrement: price } },
      });
      if (debited.count === 0) throw new SeasonConflictError('INSUFFICIENT_FUNDS');
    }, PURCHASE_TRANSACTION);
  }
}
