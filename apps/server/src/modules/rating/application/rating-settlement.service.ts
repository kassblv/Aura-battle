import type { Seat } from '@aura/rules';
import { describeCause } from '../../../shared/describe-cause.js';
import type { AppLog } from '../../../shared/log-port.js';
import type {
  GhostSeatInfo,
  MatchRatingSettlement,
  SeatRatingOutcome,
} from '../../match/domain/ports.js';
import type { PresenceLeagueCache, RatingLookup, RatingWriter } from '../domain/ports.js';
import {
  GHOST_LEAGUE_POINTS_MULTIPLIER,
  isMutualForfeit,
  leagueForMmr,
  nextRating,
  outcomeFor,
  rewardsFor,
  STARTING_RATING,
  type RatingSnapshot,
} from '../domain/rating.js';

const SEATS: readonly Seat[] = ['a', 'b'];

/** Ce que rapporte un siege que personne n'occupe. */
const NO_REWARDS = { softCurrency: 0, xp: 0 } as const;

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
    readonly ghost?: GhostSeatInfo | null;
  }): Promise<Readonly<Record<Seat, SeatRatingOutcome>>> {
    const { mode, seats, result, atMs } = input;
    const ghost = input.ghost ?? null;

    /**
     * Un fantome ne recoit rien.
     *
     * Ni classement — il n'est pas la — ni monnaie ni XP : personne ne les
     * depensera. `match:end` part quand meme vers son siege, mais il n'y a
     * aucune socket au bout (voir `GhostDirector`), donc ce zero n'est lu par
     * personne. Il est la pour que rien, nulle part, ne puisse le crediter.
     */
    const rewards = {
      a: ghost?.seat === 'a' ? NO_REWARDS : rewardsFor(outcomeFor('a', result)),
      b: ghost?.seat === 'b' ? NO_REWARDS : rewardsFor(outcomeFor('b', result)),
    };

    /**
     * Lecture au mieux : une base injoignable ne doit pas priver les joueurs
     * de leur ecran de fin de match, seulement du detail de leur classement.
     * Les recompenses, elles, ne dependent d'aucune lecture et restent donc
     * correctes meme ici.
     */
    // On ne demande le classement que des sieges qui en ont un : l'identifiant
    // d'un siege fantome n'est pas une cle de `Player`, et le lui presenter
    // ferait au mieux une lecture vide, au pire une erreur de cle etrangere.
    const humanSeats = SEATS.filter((seat) => seat !== ghost?.seat);

    let season: Awaited<ReturnType<RatingLookup['loadForMatch']>>;
    try {
      season = await this.lookup.loadForMatch(
        humanSeats.map((seat) => seats[seat]),
        atMs,
      );
    } catch (cause) {
      this.log?.warn(`classement illisible a la fin du match : ${describeCause(cause)}`);
      season = null;
    }

    if (season === null) {
      // Hors saison, ou lecture en echec : personne n'a de classement a
      // afficher, et il n'y a de toute facon rien a ecrire.
      return this.neutralOutcome(rewards, ghost);
    }

    const loadedSeason = season;
    const snapshotOf = (seat: Seat): RatingSnapshot =>
      seat === ghost?.seat
        ? // Le fantome n'a pas de ligne de classement : son MMR vient de
          // l'enregistrement, le reste ne sert a rien puisque rien ne sera ni
          // calcule ni ecrit pour lui.
          { ...STARTING_RATING, mmr: ghost.mmr, league: leagueForMmr(ghost.mmr) }
        : (loadedSeason.ratings.get(seats[seat]) ?? STARTING_RATING);

    const existing: Record<Seat, RatingSnapshot> = { a: snapshotOf('a'), b: snapshotOf('b') };

    /**
     * Ranked et pas un double abandon : le classement bouge. Un double
     * abandon ne change le classement de personne — personne n'a joue la
     * manche qui met fin au match (`isMutualForfeit`, docs/05) — mais les
     * deux sieges gardent leur classement actuel a afficher, avant = apres.
     *
     * Un match contre un fantome reste un match **classe** : docs/05 en reduit
     * le gain de moitie, il ne l'annule pas. Le siege du fantome, lui, ne bouge
     * jamais — `rateSeat` le laisse tel quel, et rien ne part a l'ecriture.
     */
    const applies = mode === 'RANKED' && !isMutualForfeit(result);
    const leaguePointsMultiplier = ghost === null ? 1 : GHOST_LEAGUE_POINTS_MULTIPLIER;

    const rateSeat = (seat: Seat): RatingSnapshot =>
      seat === ghost?.seat
        ? existing[seat]
        : nextRating(
            existing[seat],
            existing[seat === 'a' ? 'b' : 'a'].mmr,
            outcomeFor(seat, result),
            {
              leaguePointsMultiplier,
            },
          );

    const updated: Record<Seat, RatingSnapshot> = applies
      ? { a: rateSeat('a'), b: rateSeat('b') }
      : existing;

    if (applies) {
      try {
        await this.writer.saveMany(
          season.seasonId,
          humanSeats.map((seat) => ({ playerId: seats[seat], rating: updated[seat] })),
        );
        for (const seat of humanSeats) {
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
    ghost: GhostSeatInfo | null,
  ): Record<Seat, SeatRatingOutcome> {
    // Le siege du fantome n'a pas plus de classement ici qu'ailleurs : on
    // montre la ligue que son MMR implique, faute de LP a lui.
    const neutral = (seat: Seat): RatingSnapshot =>
      seat === ghost?.seat
        ? { ...STARTING_RATING, mmr: ghost.mmr, league: leagueForMmr(ghost.mmr) }
        : STARTING_RATING;
    const snapshots = { a: neutral('a'), b: neutral('b') };
    return this.buildOutcome(snapshots, snapshots, rewards);
  }
}
