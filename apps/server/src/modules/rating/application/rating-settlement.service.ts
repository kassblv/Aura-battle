import type { Seat } from '@aura/rules';
import { describeCause } from '../../../shared/describe-cause.js';
import type { AppLog } from '../../../shared/log-port.js';
import type {
  GhostSeatInfo,
  MatchRatingSettlement,
  SeatRatingOutcome,
} from '../../match/domain/ports.js';
import type {
  PresenceLeagueCache,
  RatingLookup,
  RatingWriter,
  WalletCredit,
} from '../domain/ports.js';
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
const NO_REWARDS = { softCurrency: 0, xp: 0, xpTotal: 0 } as const;

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
    /** Absent en test : la bourse n'est alors pas creditee. */
    private readonly wallets: WalletCredit | null = null,
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
      const totals = await this.creditWallets(seats, rewards, ghost, null);
      return this.neutralOutcome(this.withTotals(seats, rewards, totals), ghost);
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
        const totals = await this.creditWallets(seats, rewards, ghost, season.seasonId);
        return this.buildOutcome(existing, existing, this.withTotals(seats, rewards, totals));
      }
    }

    const totals = await this.creditWallets(seats, rewards, ghost, season.seasonId);
    return this.buildOutcome(existing, updated, this.withTotals(seats, rewards, totals));
  }

  /**
   * Credite ce qui vient d'etre annonce.
   *
   * Un credit rate **ne fait pas echouer le match** : il est fini, les joueurs
   * l'ont vu. Lever ici transformerait une ecriture ratee en partie perdue
   * pour les deux, alors que la seule chose qui manque est quelques pieces —
   * reconstructibles depuis le journal des matchs.
   *
   * Le siege du fantome n'a pas de bourse : rien ne part a son nom.
   *
   * `seasonId` : la saison du match, pour l'XP du passe ; `null` hors saison
   * ou quand le classement n'a pu etre lu — l'experience du joueur monte
   * quand meme, seule celle de la saison attend le match suivant.
   */
  private async creditWallets(
    seats: Readonly<Record<Seat, string>>,
    rewards: Record<Seat, { softCurrency: number; xp: number }>,
    ghost: GhostSeatInfo | null,
    seasonId: string | null,
  ): Promise<ReadonlyMap<string, number>> {
    if (this.wallets === null) return new Map();

    /*
      On credite des qu'il y a QUELQUE CHOSE a crediter.

      Le filtre ne portait que sur la monnaie : un match qui n'aurait rapporte
      que de l'experience n'aurait rien ecrit du tout — et l'experience est
      precisement ce qui doit monter meme quand le reste ne monte pas.
    */
    const entries = SEATS.filter((seat) => seat !== ghost?.seat)
      .filter((seat) => rewards[seat].softCurrency > 0 || rewards[seat].xp > 0)
      .map((seat) => ({
        playerId: seats[seat],
        soft: rewards[seat].softCurrency,
        xp: rewards[seat].xp,
      }));
    if (entries.length === 0) return new Map();

    try {
      return await this.wallets.credit(entries, seasonId);
    } catch (cause) {
      this.log?.warn(`credit de fin de match en echec : ${describeCause(cause)}`);
      /*
        Un credit rate rend une carte VIDE, donc un total d'experience a zero.

        C'est le bon defaut : le client dessine alors la barre du niveau un et
        n'annonce aucun palier. Inventer un total en additionnant le gain a un
        chiffre qu'on n'a pas lu ferait feter un niveau que la base ne
        connait pas — et que le joueur perdrait au prochain match.
      */
      return new Map();
    }
  }

  /**
   * Recolle le total d'experience a ce qui a ete annonce.
   *
   * Le gain seul ne dit rien du niveau : c'est le cumul qui le decide. Le
   * siege du fantome n'a pas de total — il n'a pas de compte.
   */
  private withTotals(
    seats: Readonly<Record<Seat, string>>,
    rewards: Record<Seat, { softCurrency: number; xp: number }>,
    totals: ReadonlyMap<string, number>,
  ): Record<Seat, { softCurrency: number; xp: number; xpTotal: number }> {
    const forSeat = (seat: Seat) => ({
      ...rewards[seat],
      xpTotal: totals.get(seats[seat]) ?? 0,
    });
    return { a: forSeat('a'), b: forSeat('b') };
  }

  private buildOutcome(
    before: Record<Seat, RatingSnapshot>,
    after: Record<Seat, RatingSnapshot>,
    rewards: Record<Seat, { softCurrency: number; xp: number; xpTotal: number }>,
  ): Record<Seat, SeatRatingOutcome> {
    const forSeat = (seat: Seat): SeatRatingOutcome => ({
      before: { leaguePoints: before[seat].leaguePoints, league: before[seat].league },
      after: { leaguePoints: after[seat].leaguePoints, league: after[seat].league },
      rewards: rewards[seat],
    });
    return { a: forSeat('a'), b: forSeat('b') };
  }

  private neutralOutcome(
    rewards: Record<Seat, { softCurrency: number; xp: number; xpTotal: number }>,
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
