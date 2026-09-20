import type { Seat } from '@aura/rules';
import { describeCause } from '../../../shared/describe-cause.js';
import type { AppLog } from '../../../shared/log-port.js';
import type { MatchRatingSettlement, SeatRatingOutcome } from '../../match/domain/ports.js';
import type { PresenceLeagueCache, RatingLookup, RatingWriter } from '../domain/ports.js';
import {
  isMutualForfeit,
  nextRating,
  outcomeFor,
  rewardsFor,
  STARTING_RATING,
  type RatingSnapshot,
} from '../domain/rating.js';

const SEATS: readonly Seat[] = ['a', 'b'];

/**
 * Classement et recompenses d'un match acheve (docs/05, ADR 0010).
 *
 * Realise `MatchRatingSettlement`, defini a cote de son seul appelant
 * (`match/domain/ports.ts`) : cette classe vit dans le module `rating`, le
 * port qu'elle satisfait vit dans le module `match`. Meme montage que
 * `MatchOpener` pour `MatchOpening` (`matchmaking/domain/ports.ts`).
 *
 * Toute la logique de calcul est deleguee a `rating.ts`, pur. Ce service
 * n'ajoute que l'orchestration : lire, decider si le classement s'applique,
 * ecrire, rafraichir le cache de presence — et ne jamais faire echouer une
 * fin de match pour une base de donnees indisponible.
 */
export class RatingSettlementService implements MatchRatingSettlement {
  constructor(
    private readonly lookup: RatingLookup,
    private readonly writer: RatingWriter,
    /** Absent en test : le cache de ligue de la session n'est alors pas rafraichi. */
    private readonly presenceCache: PresenceLeagueCache | null = null,
    private readonly log: AppLog | null = null,
  ) {}

  async settle(input: {
    readonly mode: 'RANKED' | 'CASUAL' | 'INVITE' | 'SOLO';
    readonly seats: Readonly<Record<Seat, string>>;
    readonly result: { readonly winner: Seat | null; readonly reason: string };
    readonly atMs: number;
  }): Promise<Readonly<Record<Seat, SeatRatingOutcome>>> {
    const { mode, seats, result, atMs } = input;
    const rewards = {
      a: rewardsFor(outcomeFor('a', result)),
      b: rewardsFor(outcomeFor('b', result)),
    };

    /**
     * Lecture au mieux : une base injoignable ne doit pas priver les joueurs
     * de leur ecran de fin de match, seulement du detail de leur classement.
     * Les recompenses, elles, ne dependent d'aucune lecture et restent donc
     * correctes meme ici.
     */
    let season: Awaited<ReturnType<RatingLookup['loadForMatch']>>;
    try {
      season = await this.lookup.loadForMatch([seats.a, seats.b], atMs);
    } catch (cause) {
      this.log?.warn(`classement illisible a la fin du match : ${describeCause(cause)}`);
      season = null;
    }

    if (season === null) {
      // Hors saison, ou lecture en echec : personne n'a de classement a
      // afficher, et il n'y a de toute facon rien a ecrire.
      return this.neutralOutcome(rewards);
    }

    const existing: Record<Seat, RatingSnapshot> = {
      a: season.ratings.get(seats.a) ?? STARTING_RATING,
      b: season.ratings.get(seats.b) ?? STARTING_RATING,
    };

    /**
     * Ranked et pas un double abandon : le classement bouge. Un double
     * abandon ne change le classement de personne — personne n'a joue la
     * manche qui met fin au match (`isMutualForfeit`, docs/05) — mais les
     * deux sieges gardent leur classement actuel a afficher, avant = apres.
     */
    const applies = mode === 'RANKED' && !isMutualForfeit(result);

    const updated: Record<Seat, RatingSnapshot> = applies
      ? {
          a: nextRating(existing.a, existing.b.mmr, outcomeFor('a', result)),
          b: nextRating(existing.b, existing.a.mmr, outcomeFor('b', result)),
        }
      : existing;

    if (applies) {
      try {
        await this.writer.saveMany(season.seasonId, [
          { playerId: seats.a, rating: updated.a },
          { playerId: seats.b, rating: updated.b },
        ]);
        for (const seat of SEATS) {
          this.presenceCache?.setLeague(seats[seat], updated[seat].league);
        }
      } catch (cause) {
        // Journalise deja par l'adaptateur (detail de la cause). On ne
        // reafffiche pas le classement ecrit : l'ecriture a peut-etre
        // partiellement reussi, et le joueur verrait alors un chiffre que la
        // base ne confirme pas. Le match reste acheve cote joueurs, seul le
        // classement affiche retombe sur l'ancien.
        this.log?.warn(
          `ecriture du classement en echec, classement inchange affiche : ${describeCause(cause)}`,
        );
        return this.buildOutcome(existing, existing, rewards);
      }
    }

    return this.buildOutcome(existing, updated, rewards);
  }

  private buildOutcome(
    before: Record<Seat, RatingSnapshot>,
    after: Record<Seat, RatingSnapshot>,
    rewards: Record<Seat, { softCurrency: number; xp: number }>,
  ): Record<Seat, SeatRatingOutcome> {
    const forSeat = (seat: Seat): SeatRatingOutcome => ({
      before: { leaguePoints: before[seat].leaguePoints, league: before[seat].league },
      after: { leaguePoints: after[seat].leaguePoints, league: after[seat].league },
      rewards: rewards[seat],
    });
    return { a: forSeat('a'), b: forSeat('b') };
  }

  private neutralOutcome(
    rewards: Record<Seat, { softCurrency: number; xp: number }>,
  ): Record<Seat, SeatRatingOutcome> {
    return this.buildOutcome(
      { a: STARTING_RATING, b: STARTING_RATING },
      { a: STARTING_RATING, b: STARTING_RATING },
      rewards,
    );
  }
}
