import { Inject, Injectable } from '@nestjs/common';
import { League as LeagueColumn } from '@prisma/client';
import { currentSeasonId } from '../../../shared/current-season.js';
import { describeCause } from '../../../shared/describe-cause.js';
import { PinoLoggerService } from '../../../shared/logger.js';
import { PrismaService } from '../../../shared/prisma.service.js';
import type {
  RatingDirectory,
  RatingLookup,
  RatingWriter,
  SeasonRatings,
  WalletCredit,
} from '../domain/ports.js';
import type { League, RatingSnapshot } from '../domain/rating.js';

/**
 * Adaptateur Prisma des ports de lecture/ecriture du classement (docs/04).
 *
 * Trois ports, un seul adaptateur : les trois lisent ou ecrivent la meme
 * table `Rating`, avec la meme conversion d'enum. Les separer en trois
 * classes n'aurait rien separe de reel — meme choix que `RedisQueueStore`
 * pour `QueueTicketStore`/`RecentOpponentStore` (ADR 0009).
 */

/**
 * Ligues : le domaine dit `sans_aura`, l'enum Prisma dit `SANS_AURA`.
 *
 * Meme raison que `SEAT_COLUMN` dans `prisma-match.repository.ts` (ADR 0006) :
 * la conversion est explicite et centralisee ici, jamais devinee par une
 * transformation de chaine qui romprait au premier renommage silencieux.
 */
const LEAGUE_COLUMN = {
  sans_aura: LeagueColumn.SANS_AURA,
  naissante: LeagueColumn.NAISSANTE,
  stable: LeagueColumn.STABLE,
  rayonnante: LeagueColumn.RAYONNANTE,
  legendaire: LeagueColumn.LEGENDAIRE,
  infinie: LeagueColumn.INFINIE,
} as const satisfies Record<League, LeagueColumn>;

const LEAGUE_FROM_COLUMN: Record<LeagueColumn, League> = {
  [LeagueColumn.SANS_AURA]: 'sans_aura',
  [LeagueColumn.NAISSANTE]: 'naissante',
  [LeagueColumn.STABLE]: 'stable',
  [LeagueColumn.RAYONNANTE]: 'rayonnante',
  [LeagueColumn.LEGENDAIRE]: 'legendaire',
  [LeagueColumn.INFINIE]: 'infinie',
};

interface RatingRow {
  playerId: string;
  mmr: number;
  rd: number;
  leaguePoints: number;
  league: LeagueColumn;
  placements: number;
  wins: number;
  losses: number;
}

function toSnapshot(row: RatingRow): RatingSnapshot {
  return {
    mmr: row.mmr,
    rd: row.rd,
    leaguePoints: row.leaguePoints,
    league: LEAGUE_FROM_COLUMN[row.league],
    placements: row.placements,
    wins: row.wins,
    losses: row.losses,
  };
}

@Injectable()
export class PrismaRatingRepository
  implements RatingLookup, RatingWriter, RatingDirectory, WalletCredit
{
  // Jeton explicite : esbuild n'emet pas `design:paramtypes` (voir CLAUDE.md).
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(PinoLoggerService) private readonly logger: PinoLoggerService,
  ) {}

  async loadForMatch(playerIds: readonly string[], nowMs: number): Promise<SeasonRatings | null> {
    const seasonId = await currentSeasonId(this.prisma, nowMs);
    if (seasonId === null) return null;
    if (playerIds.length === 0) return { seasonId, ratings: new Map() };

    const rows = await this.prisma.rating.findMany({
      where: { seasonId, playerId: { in: [...playerIds] } },
      select: {
        playerId: true,
        mmr: true,
        rd: true,
        leaguePoints: true,
        league: true,
        placements: true,
        wins: true,
        losses: true,
      },
    });

    return { seasonId, ratings: new Map(rows.map((row) => [row.playerId, toSnapshot(row)])) };
  }

  async leaguesOf(
    playerIds: readonly string[],
    nowMs: number,
  ): Promise<ReadonlyMap<string, string>> {
    if (playerIds.length === 0) return new Map();
    const seasonId = await currentSeasonId(this.prisma, nowMs);
    if (seasonId === null) return new Map();

    const rows = await this.prisma.rating.findMany({
      where: { seasonId, playerId: { in: [...playerIds] } },
      select: { playerId: true, league: true },
    });

    return new Map(rows.map((row) => [row.playerId, LEAGUE_FROM_COLUMN[row.league]]));
  }

  /**
   * Ecrit le classement de plusieurs joueurs pour une saison, **d'un seul
   * geste**.
   *
   * Un match acheve met a jour deux joueurs a la fois : sans transaction, un
   * echec sur le second laisserait le premier deja ecrit, et le match
   * compterait pour l'un sans compter pour l'autre. Une erreur remonte —
   * `MatchRatingSettlement` decide seul de ce qu'un classement non ecrit doit
   * faire du reste de la fin de match (rien, docs/05 : le resultat est deja
   * parti chez les joueurs).
   */
  /**
   * Credite la monnaie douce de plusieurs joueurs, en une transaction.
   *
   * `increment` et non une lecture suivie d'une ecriture : deux matchs qui
   * s'achevent au meme instant pour le meme joueur — ca arrive, il suffit de
   * deux onglets — perdraient l'un des deux credits. L'incrementation se fait
   * dans la base, qui sait les empiler.
   */
  async credit(
    entries: readonly { readonly playerId: string; readonly soft: number }[],
  ): Promise<void> {
    if (entries.length === 0) return;
    await this.prisma.$transaction(
      entries.map((entry) =>
        this.prisma.player.update({
          where: { id: entry.playerId },
          data: { softCurrency: { increment: entry.soft } },
        }),
      ),
    );
  }

  async saveMany(
    seasonId: string,
    entries: readonly { readonly playerId: string; readonly rating: RatingSnapshot }[],
  ): Promise<void> {
    if (entries.length === 0) return;

    try {
      await this.prisma.$transaction(
        entries.map(({ playerId, rating }) =>
          this.prisma.rating.upsert({
            where: { playerId_seasonId: { playerId, seasonId } },
            create: { playerId, seasonId, ...this.columnsFor(rating) },
            update: this.columnsFor(rating),
          }),
        ),
      );
    } catch (error) {
      this.logger.error(
        new Error(
          `ecriture du classement impossible pour la saison ${seasonId} : ${describeCause(error)}`,
        ),
        undefined,
        'PrismaRatingRepository',
      );
      throw error;
    }
  }

  /**
   * Colonnes scalaires du classement, partagees par `create` et `update`.
   *
   * Volontairement sans annotation Prisma : une valeur scalaire simple
   * appartient deja aux deux types generes (`RatingUncheckedCreateInput` et
   * `RatingUncheckedUpdateInput` acceptent tous deux `number`/`string` nus),
   * mais annoter ce retour avec l'un des deux force le compilateur a verifier
   * l'objet compose dans `create` contre l'autre, et le rejette a tort.
   */
  private columnsFor(rating: RatingSnapshot) {
    return {
      mmr: rating.mmr,
      rd: rating.rd,
      leaguePoints: rating.leaguePoints,
      league: LEAGUE_COLUMN[rating.league],
      placements: rating.placements,
      wins: rating.wins,
      losses: rating.losses,
    };
  }
}
