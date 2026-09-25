import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type { Seat } from '@aura/rules';
import {
  GHOST_LEAGUE_POINTS_MULTIPLIER,
  isMutualForfeit,
  type League,
  leagueFor,
  leagueForMmr,
  type MatchOutcome,
  nextLeaguePoints,
  nextMmr,
  nextRating,
  outcomeFor,
  PLACEMENT_MATCHES,
  type RatingOutcome,
  type RatingSnapshot,
  rewardsFor,
  seasonCarryOver,
  STARTING_RATING,
} from './rating.js';

/**
 * Calcul du classement (docs/05, ADR 0010).
 *
 * Module pur : aucun de ces tests n'attend, n'ouvre de connexion, ni ne lit
 * l'horloge. Les invariants demandes par le jalon M5 sont verifies par
 * propriete plutot que sur des exemples choisis a la main — un MMR negatif ou
 * un vainqueur qui perd des points ne doit pas seulement etre absent des cas
 * qu'on a pense a ecrire.
 */

const seatArb = fc.constantFrom<Seat>('a', 'b');
const mmrArb = fc.integer({ min: 0, max: 4_000 });
const lpArb = fc.integer({ min: 0, max: 8_000 });
const placementsArb = fc.integer({ min: 0, max: PLACEMENT_MATCHES + 3 });
const ratingOutcomeArb = fc.constantFrom<RatingOutcome>('win', 'loss', 'draw');
const matchOutcomeArb = fc.constantFrom<MatchOutcome>('win', 'loss', 'draw', 'forfeited');

const ratingArb = fc.record<RatingSnapshot>({
  mmr: mmrArb,
  rd: fc.constant(350),
  leaguePoints: lpArb,
  league: fc.constant<League>('sans_aura'), // recalculee, jamais lue par nextRating
  placements: placementsArb,
  wins: fc.nat(200),
  losses: fc.nat(200),
});

describe('leagueFor — seuils de ligue (docs/05)', () => {
  it.each([
    [0, 'sans_aura'],
    [99, 'sans_aura'],
    [100, 'naissante'],
    [399, 'naissante'],
    [400, 'stable'],
    [999, 'stable'],
    [1_000, 'rayonnante'],
    [2_499, 'rayonnante'],
    [2_500, 'legendaire'],
    [5_999, 'legendaire'],
    [6_000, 'infinie'],
    [50_000, 'infinie'],
  ] as const)('%i LP -> %s', (lp, expected) => {
    expect(leagueFor(lp)).toBe(expected);
  });

  it('est croissante avec les LP', () => {
    fc.assert(
      fc.property(lpArb, fc.integer({ min: 0, max: 500 }), (lp, extra) => {
        const order: League[] = [
          'sans_aura',
          'naissante',
          'stable',
          'rayonnante',
          'legendaire',
          'infinie',
        ];
        expect(order.indexOf(leagueFor(lp + extra))).toBeGreaterThanOrEqual(
          order.indexOf(leagueFor(lp)),
        );
      }),
    );
  });
});

describe('outcomeFor — issue de classement d un siege (docs/05)', () => {
  it('rend "win" au siege qui gagne sur les manches', () => {
    expect(outcomeFor('a', { winner: 'a', reason: 'rounds' })).toBe('win');
    expect(outcomeFor('b', { winner: 'a', reason: 'rounds' })).toBe('loss');
  });

  it('rend "draw" aux deux sieges d un departage nul', () => {
    expect(outcomeFor('a', { winner: null, reason: 'tiebreak' })).toBe('draw');
    expect(outcomeFor('b', { winner: null, reason: 'tiebreak' })).toBe('draw');
  });

  it('rend "forfeited" au siege qui abandonne, "win" a l autre', () => {
    expect(outcomeFor('a', { winner: 'b', reason: 'forfeit' })).toBe('forfeited');
    expect(outcomeFor('b', { winner: 'b', reason: 'forfeit' })).toBe('win');
  });

  it('rend "forfeited" aux deux sieges d un double abandon', () => {
    expect(outcomeFor('a', { winner: null, reason: 'forfeit' })).toBe('forfeited');
    expect(outcomeFor('b', { winner: null, reason: 'forfeit' })).toBe('forfeited');
  });
});

describe('isMutualForfeit', () => {
  it('vrai seulement pour un forfait sans vainqueur', () => {
    expect(isMutualForfeit({ winner: null, reason: 'forfeit' })).toBe(true);
    expect(isMutualForfeit({ winner: 'a', reason: 'forfeit' })).toBe(false);
    expect(isMutualForfeit({ winner: null, reason: 'tiebreak' })).toBe(false);
  });
});

describe('nextMmr — Elo a K variable (ADR 0010)', () => {
  it('ne rend jamais un MMR negatif', () => {
    fc.assert(
      fc.property(
        mmrArb,
        mmrArb,
        ratingOutcomeArb,
        placementsArb,
        (mmr, opponentMmr, outcome, placements) => {
          expect(nextMmr(mmr, opponentMmr, outcome, placements)).toBeGreaterThanOrEqual(0);
        },
      ),
    );
  });

  it('un vainqueur ne perd jamais de MMR', () => {
    fc.assert(
      fc.property(mmrArb, mmrArb, placementsArb, (mmr, opponentMmr, placements) => {
        expect(nextMmr(mmr, opponentMmr, 'win', placements)).toBeGreaterThanOrEqual(mmr);
      }),
    );
  });

  it('un perdant ne gagne jamais de MMR', () => {
    fc.assert(
      fc.property(mmrArb, mmrArb, placementsArb, (mmr, opponentMmr, placements) => {
        expect(nextMmr(mmr, opponentMmr, 'loss', placements)).toBeLessThanOrEqual(mmr);
      }),
    );
  });

  it('le delta ne depasse jamais le K de placement (borne, docs/05)', () => {
    fc.assert(
      fc.property(
        mmrArb,
        mmrArb,
        ratingOutcomeArb,
        placementsArb,
        (mmr, opponentMmr, outcome, placements) => {
          const after = nextMmr(mmr, opponentMmr, outcome, placements);
          // Le plancher a zero peut a lui seul creer un ecart plus grand que le
          // K si `mmr` etait deja proche de zero : la borne ne vaut donc que
          // loin du plancher, ou aucun clamp n'intervient.
          if (mmr > 60 && after > 60) {
            expect(Math.abs(after - mmr)).toBeLessThanOrEqual(60);
          }
        },
      ),
    );
  });

  it('est zero-somme entre deux joueurs hors placement (meme K, ADR 0010)', () => {
    fc.assert(
      fc.property(
        mmrArb,
        mmrArb,
        fc.integer({ min: PLACEMENT_MATCHES, max: 50 }),
        (mmrA, mmrB, placements) => {
          // Loin des planchers, pour observer la symetrie sans clamp.
          fc.pre(mmrA > 100 && mmrB > 100);
          const winnerAfter = nextMmr(mmrA, mmrB, 'win', placements);
          const loserAfter = nextMmr(mmrB, mmrA, 'loss', placements);
          expect(winnerAfter - mmrA).toBeCloseTo(-(loserAfter - mmrB), 6);
        },
      ),
    );
  });

  it('K est majore durant les placements', () => {
    const gain = (placements: number): number => nextMmr(1_000, 1_000, 'win', placements) - 1_000;
    expect(gain(0)).toBeGreaterThan(gain(PLACEMENT_MATCHES));
  });
});

describe('nextLeaguePoints — base +-20 corrigee (docs/05)', () => {
  it('ne rend jamais des LP negatifs', () => {
    fc.assert(
      fc.property(mmrArb, lpArb, ratingOutcomeArb, (mmr, lp, outcome) => {
        expect(nextLeaguePoints(mmr, lp, outcome)).toBeGreaterThanOrEqual(0);
      }),
    );
  });

  it('un vainqueur gagne toujours des LP', () => {
    fc.assert(
      fc.property(mmrArb, lpArb, (mmr, lp) => {
        expect(nextLeaguePoints(mmr, lp, 'win')).toBeGreaterThan(lp);
      }),
    );
  });

  it('un perdant perd toujours des LP, sauf au plancher', () => {
    fc.assert(
      fc.property(mmrArb, lpArb, (mmr, lp) => {
        const after = nextLeaguePoints(mmr, lp, 'loss');
        if (lp > 30) expect(after).toBeLessThan(lp);
        expect(after).toBeGreaterThanOrEqual(0);
      }),
    );
  });

  it('a mmr egal aux LP, la base vaut exactement +-20', () => {
    // impliedLp = mmr - 1000 ; a mmr = 1000 + lp, l ecart est nul.
    expect(nextLeaguePoints(1_200, 200, 'win')).toBe(220);
    expect(nextLeaguePoints(1_200, 200, 'loss')).toBe(180);
  });

  it('un joueur sous-classe (MMR au-dessus des LP) gagne plus et perd moins', () => {
    const baseline = 200;
    const underranked = nextLeaguePoints(1_600, baseline, 'win') - baseline; // MMR implique 600 LP
    const atLevel = nextLeaguePoints(1_200, baseline, 'win') - baseline;
    expect(underranked).toBeGreaterThan(atLevel);

    const lossUnderranked = baseline - nextLeaguePoints(1_600, baseline, 'loss');
    const lossAtLevel = baseline - nextLeaguePoints(1_200, baseline, 'loss');
    expect(lossUnderranked).toBeLessThan(lossAtLevel);
  });
});

describe('nextRating — application complete (docs/05)', () => {
  it('un forfait compte comme une defaite pour le MMR et les LP', () => {
    fc.assert(
      fc.property(ratingArb, mmrArb, (rating, opponentMmr) => {
        const asLoss = nextRating(rating, opponentMmr, 'loss');
        const asForfeit = nextRating(rating, opponentMmr, 'forfeited');
        expect(asForfeit.mmr).toBe(asLoss.mmr);
        expect(asForfeit.leaguePoints).toBe(asLoss.leaguePoints);
        expect(asForfeit.losses).toBe(asLoss.losses);
      }),
    );
  });

  it('les placements progressent jusqu a cinq puis se figent (docs/05)', () => {
    fc.assert(
      fc.property(ratingArb, mmrArb, matchOutcomeArb, (rating, opponentMmr, outcome) => {
        const after = nextRating(rating, opponentMmr, outcome);
        expect(after.placements).toBe(Math.min(PLACEMENT_MATCHES, rating.placements + 1));
        expect(after.placements).toBeLessThanOrEqual(PLACEMENT_MATCHES);
      }),
    );
  });

  it('la ligue rendue correspond toujours aux LP rendus', () => {
    fc.assert(
      fc.property(ratingArb, mmrArb, matchOutcomeArb, (rating, opponentMmr, outcome) => {
        const after = nextRating(rating, opponentMmr, outcome);
        expect(after.league).toBe(leagueFor(after.leaguePoints));
      }),
    );
  });

  it('compte les victoires et defaites, jamais les nuls ni les abandons', () => {
    const base = STARTING_RATING;
    expect(nextRating(base, 1_000, 'win').wins).toBe(1);
    expect(nextRating(base, 1_000, 'win').losses).toBe(0);
    expect(nextRating(base, 1_000, 'loss').wins).toBe(0);
    expect(nextRating(base, 1_000, 'loss').losses).toBe(1);
    expect(nextRating(base, 1_000, 'draw').wins).toBe(0);
    expect(nextRating(base, 1_000, 'draw').losses).toBe(0);
    expect(nextRating(base, 1_000, 'forfeited').losses).toBe(1);
  });
});

describe('rewardsFor — bareme (docs/05, anti-ferme)', () => {
  it('l abandon ne rapporte jamais rien', () => {
    expect(rewardsFor('forfeited')).toEqual({ softCurrency: 0, xp: 0 });
  });

  it('une defaite jouee rapporte strictement plus qu un abandon', () => {
    const loss = rewardsFor('loss');
    const forfeited = rewardsFor('forfeited');
    expect(loss.softCurrency).toBeGreaterThan(forfeited.softCurrency);
    expect(loss.xp).toBeGreaterThan(forfeited.xp);
  });

  it('une victoire rapporte plus qu un nul, qui rapporte plus qu une defaite', () => {
    const win = rewardsFor('win');
    const draw = rewardsFor('draw');
    const loss = rewardsFor('loss');
    expect(win.softCurrency).toBeGreaterThan(draw.softCurrency);
    expect(draw.softCurrency).toBeGreaterThan(loss.softCurrency);
  });

  it('rend toujours des entiers positifs ou nuls (contrat protocole)', () => {
    for (const outcome of ['win', 'loss', 'draw', 'forfeited'] as const) {
      const reward = rewardsFor(outcome);
      expect(Number.isInteger(reward.softCurrency)).toBe(true);
      expect(Number.isInteger(reward.xp)).toBe(true);
      expect(reward.softCurrency).toBeGreaterThanOrEqual(0);
      expect(reward.xp).toBeGreaterThanOrEqual(0);
    }
  });
});

describe('seatArb — usage garanti dans outcomeFor (garde-fou anti-inutilise)', () => {
  it('outcomeFor traite les deux sieges de facon symetrique', () => {
    fc.assert(
      fc.property(seatArb, (seat) => {
        const opponent: Seat = seat === 'a' ? 'b' : 'a';
        expect(outcomeFor(seat, { winner: seat, reason: 'rounds' })).toBe('win');
        expect(outcomeFor(opponent, { winner: seat, reason: 'rounds' })).toBe('loss');
      }),
    );
  });
});

/**
 * Reduction des LP contre un fantome (docs/05 § « Fantomes »).
 *
 * « Un match contre un fantome rapporte 50 % des LP habituels. » Elle vit dans
 * ce module et nulle part ailleurs : une seconde formule ailleurs dans le
 * serveur finirait par diverger de celle-ci.
 */
describe('nextLeaguePoints — part des LP gagnes', () => {
  it('vaut la moitie, comme le document le dit', () => {
    expect(GHOST_LEAGUE_POINTS_MULTIPLIER).toBe(0.5);
  });

  it('ne change rien quand la part vaut un', () => {
    expect(nextLeaguePoints(1_000, 100, 'win', 1)).toBe(nextLeaguePoints(1_000, 100, 'win'));
  });

  it('coupe le gain en deux', () => {
    const entier = nextLeaguePoints(1_000, 100, 'win') - 100;
    const moitie = nextLeaguePoints(1_000, 100, 'win', GHOST_LEAGUE_POINTS_MULTIPLIER) - 100;
    expect(moitie).toBe(Math.round(entier / 2));
  });

  /**
   * La propriete qui compte : reduire ne doit **jamais** inverser le sens du
   * resultat. Un vainqueur qui perd des LP, ou un perdant qui en gagne, serait
   * pire qu'un gain reduit.
   */
  it('ne retourne jamais le signe du delta', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 3_000 }),
        fc.integer({ min: 0, max: 8_000 }),
        (mmr, leaguePoints) => {
          const gagne = nextLeaguePoints(mmr, leaguePoints, 'win', GHOST_LEAGUE_POINTS_MULTIPLIER);
          expect(gagne).toBeGreaterThan(leaguePoints);

          const perdu = nextLeaguePoints(mmr, leaguePoints, 'loss', GHOST_LEAGUE_POINTS_MULTIPLIER);
          // Plancher a zero : on ne descend jamais sous le bas de l'echelle.
          expect(perdu).toBeLessThanOrEqual(leaguePoints);
          if (leaguePoints > 0) expect(perdu).toBeLessThan(leaguePoints);
        },
      ),
    );
  });

  it('se transmet par nextRating sans toucher au MMR', () => {
    const base: RatingSnapshot = { ...STARTING_RATING, mmr: 1_200, leaguePoints: 300 };
    const humain = nextRating(base, 1_200, 'win');
    const fantome = nextRating(base, 1_200, 'win', {
      leaguePointsMultiplier: GHOST_LEAGUE_POINTS_MULTIPLIER,
    });

    expect(fantome.mmr).toBe(humain.mmr);
    expect(fantome.leaguePoints - 300).toBe(Math.round((humain.leaguePoints - 300) / 2));
  });
});

describe('leagueForMmr — quelle ligue montrer pour qui n a pas de LP', () => {
  it('place le MMR de depart au bas de l echelle', () => {
    expect(leagueForMmr(1_000)).toBe('sans_aura');
    expect(leagueForMmr(0)).toBe('sans_aura');
  });

  it('suit la meme echelle que les LP', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 10_000 }), (mmr) => {
        expect(leagueForMmr(mmr)).toBe(leagueFor(Math.max(0, mmr - 1_000)));
      }),
    );
  });
});

/*
  La reinitialisation douce de fin de saison (docs/05) : on ne repart pas de
  zero, on repart plus bas. Le MMR se resserre de 20 % vers 1 000, les LP sont
  divises par deux, et la saison rouvre ses cinq matchs de placement.
*/
describe('seasonCarryOver', () => {
  const previous = {
    ...STARTING_RATING,
    mmr: 1_500,
    leaguePoints: 2_600,
    league: 'legendaire' as const,
    placements: 5,
    wins: 40,
    losses: 12,
  };

  it('resserre le MMR de 20 % vers 1 000, dans les deux sens', () => {
    expect(seasonCarryOver(previous).mmr).toBe(1_400);
    expect(seasonCarryOver({ ...previous, mmr: 800 }).mmr).toBe(840);
  });

  it('divise les LP par deux, et en deduit la ligue', () => {
    const next = seasonCarryOver(previous);
    expect(next.leaguePoints).toBe(1_300);
    expect(next.league).toBe(leagueFor(1_300));
  });

  it('rouvre les placements et le bilan de la saison', () => {
    expect(seasonCarryOver(previous)).toMatchObject({ placements: 0, wins: 0, losses: 0 });
  });

  it('laisse un nouveau venu au depart', () => {
    expect(seasonCarryOver(STARTING_RATING)).toEqual(STARTING_RATING);
  });
});
