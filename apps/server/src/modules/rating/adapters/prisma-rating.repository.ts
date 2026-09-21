import { Inject, Injectable } from '@nestjs/common';
import { League as LeagueColumn } from '@prisma/client';
import { currentSeasonId } from '../../../shared/current-season.js';
import { describeCause } from '../../../shared/describe-cause.js';
import { PinoLoggerService } from '../../../shared/logger.js';
import { PrismaService } from '../../../shared/prisma.service.js';
import type { RankedRow } from '../domain/leaderboard.js';
import type {
  RatingDirectory,
  RatingLookup,
  RatingWriter,
  LeaderboardReader,
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

/**
 * Traduit la ligue de la COLONNE vers celle du domaine.
 *
 * Le reste du depot passe par `LEAGUE_FROM_COLUMN` ; une requete SQL brute
 * rend `r.league::text`, c'est-a-dire le nom de la valeur d'enum Postgres —
 * `INFINIE` la ou le client attend `infinie`. Sans cette traduction, l'ecran
 * affiche « Non classe » pour tout le monde, et rien dans le code ne le
 * signale : les deux cotes manipulent des chaines, et elles se ressemblent.
 */
function withDomainLeague(row: RankedRow): RankedRow {
  return { ...row, league: LEAGUE_FROM_COLUMN[row.league as LeagueColumn] ?? row.league };
}

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
  implements RatingLookup, RatingWriter, RatingDirectory, WalletCredit, LeaderboardReader
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

  /**
   * Les meilleurs de la saison.
   *
   * Le rang vient de la base (`row_number`), pas d'un compteur en memoire :
   * calculer un rang cote serveur obligerait a charger tout le classement
   * pour n'en montrer que cinquante lignes.
   *
   * Le tri porte un **departage explicite** sur `playerId`. Sans lui, deux
   * joueurs a egalite de points changeraient de place d'une requete a
   * l'autre — et un classement ou l'on monte et descend sans rien faire ne
   * se croit plus.
   */
  async top(limit: number, nowMs: number): Promise<readonly RankedRow[]> {
    const seasonId = await currentSeasonId(this.prisma, nowMs);
    if (seasonId === null) return [];

    const rows = await this.prisma.$queryRaw<RankedRow[]>`
      select
        cast(row_number() over (order by r."leaguePoints" desc, r."playerId" asc) as int) as rank,
        r."playerId", p."displayName", r."leaguePoints",
        r.league::text as league, r.wins, r.losses
      from "Rating" r
      join "Player" p on p.id = r."playerId"
      where r."seasonId" = ${seasonId}
      order by r."leaguePoints" desc, r."playerId" asc
      limit ${limit}
    `;
    return rows.map(withDomainLeague);
  }

  /**
   * Le joueur et ses voisins immediats.
   *
   * Une seule requete, avec le classement complet numerote une fois : deux
   * requetes — « quel est mon rang », puis « qui est autour » — pourraient
   * tomber de part et d'autre d'un match qui s'acheve, et rendre un joueur
   * absent de son propre voisinage.
   */
  async around(
    playerId: string,
    neighbours: number,
    nowMs: number,
  ): Promise<{ readonly me: RankedRow; readonly rows: readonly RankedRow[] } | null> {
    const seasonId = await currentSeasonId(this.prisma, nowMs);
    if (seasonId === null) return null;

    const rows = await this.prisma.$queryRaw<RankedRow[]>`
      with classement as (
        select
          cast(row_number() over (order by r."leaguePoints" desc, r."playerId" asc) as int) as rank,
          r."playerId", p."displayName", r."leaguePoints",
          r.league::text as league, r.wins, r.losses
        from "Rating" r
        join "Player" p on p.id = r."playerId"
        where r."seasonId" = ${seasonId}
      ),
      moi as (select rank from classement where "playerId" = ${playerId})
      select classement.* from classement, moi
      where abs(classement.rank - moi.rank) <= ${neighbours}
      order by classement.rank asc
    `;

    const traduites = rows.map(withDomainLeague);
    const me = traduites.find((row) => row.playerId === playerId);
    // Aucune ligne de classement : le joueur n'a jamais fini de match classe.
    // Ce n'est pas une anomalie, c'est le cas de tous les nouveaux venus.
    return me === undefined ? null : { me, rows: traduites };
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
