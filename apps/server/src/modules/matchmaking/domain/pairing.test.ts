import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { SEARCH_WINDOW, pairTickets, searchRange } from './pairing.js';
import { DEFAULT_REGION, type QueueMode, type QueueTicket } from './ticket.js';

/**
 * Decision d'appariement (docs/05, § « File d'attente »).
 *
 * Module pur : aucune horloge, aucun Redis, aucune socket. Tout ce qui varie —
 * l'instant, les tickets — est un parametre, ce qui permet de verifier
 * l'elargissement de la fenetre sans attendre les secondes correspondantes.
 */

const ticket = (over: Partial<QueueTicket> & { playerId: string }): QueueTicket => ({
  mode: 'ranked',
  mmr: 1000,
  enqueuedAtMs: 0,
  region: DEFAULT_REGION,
  recentOpponents: [],
  ...over,
});

describe('searchRange — la fenetre s elargit avec l attente', () => {
  it('part a plus ou moins 50', () => {
    expect(searchRange(0)).toBe(50);
    expect(searchRange(999)).toBe(50);
  });

  it('gagne 25 par seconde d attente', () => {
    expect(searchRange(1_000)).toBe(75);
    expect(searchRange(4_000)).toBe(150);
  });

  it('plafonne a plus ou moins 400', () => {
    expect(searchRange(14_000)).toBe(400);
    expect(searchRange(60_000)).toBe(400);
    expect(searchRange(10 * 60_000)).toBe(400);
  });

  /**
   * Une attente negative n'est pas une hypothese d'ecole : l'horloge d'un
   * ticket vient du serveur qui l'a ecrit. Deux serveurs decales d'une
   * milliseconde suffiraient a produire une fenetre negative, donc un joueur
   * que plus personne ne peut apparier.
   */
  it('traite une attente negative comme une attente nulle', () => {
    expect(searchRange(-5_000)).toBe(50);
  });

  it('ne rend jamais qu un entier borne', () => {
    fc.assert(
      fc.property(fc.integer({ min: -1_000_000, max: 3_600_000 }), (waited) => {
        const range = searchRange(waited);
        expect(Number.isInteger(range)).toBe(true);
        expect(range).toBeGreaterThanOrEqual(SEARCH_WINDOW.initialRange);
        expect(range).toBeLessThanOrEqual(SEARCH_WINDOW.maxRange);
      }),
    );
  });
});

describe('pairTickets — qui joue contre qui', () => {
  it('ne marie personne quand un seul joueur attend', () => {
    const outcome = pairTickets([ticket({ playerId: 'p1' })], 0);
    expect(outcome.pairs).toHaveLength(0);
    expect(outcome.waiting.map((t) => t.playerId)).toEqual(['p1']);
  });

  it('marie deux joueurs de MMR proche', () => {
    const outcome = pairTickets(
      [ticket({ playerId: 'p1', mmr: 1000 }), ticket({ playerId: 'p2', mmr: 1030 })],
      0,
    );
    expect(outcome.pairs).toHaveLength(1);
    expect([outcome.pairs[0]!.a.playerId, outcome.pairs[0]!.b.playerId].sort()).toEqual([
      'p1',
      'p2',
    ]);
    expect(outcome.waiting).toHaveLength(0);
  });

  it('refuse un ecart de MMR au-dela de la fenetre', () => {
    const outcome = pairTickets(
      [ticket({ playerId: 'p1', mmr: 1000 }), ticket({ playerId: 'p2', mmr: 1200 })],
      0,
    );
    expect(outcome.pairs).toHaveLength(0);
    expect(outcome.waiting).toHaveLength(2);
  });

  /** L'elargissement finit par rendre possible ce qui ne l'etait pas. */
  it('accepte ce meme ecart une fois les deux fenetres elargies', () => {
    const tickets = [
      ticket({ playerId: 'p1', mmr: 1000, enqueuedAtMs: 0 }),
      ticket({ playerId: 'p2', mmr: 1200, enqueuedAtMs: 0 }),
    ];
    expect(pairTickets(tickets, 5_000).pairs).toHaveLength(0);
    expect(pairTickets(tickets, 7_000).pairs).toHaveLength(1);
  });

  /**
   * La fenetre du nouvel arrivant compte autant que celle du vieux.
   *
   * Sinon le joueur qui attend depuis six secondes impose son ecart de 200 a
   * quelqu'un qui vient d'entrer : le premier obtient un match, le second
   * herite d'un adversaire qu'il n'a jamais accepte de chercher.
   */
  it('exige que les DEUX fenetres acceptent l ecart', () => {
    const outcome = pairTickets(
      [
        ticket({ playerId: 'vieux', mmr: 1000, enqueuedAtMs: 0 }),
        ticket({ playerId: 'neuf', mmr: 1200, enqueuedAtMs: 20_000 }),
      ],
      20_000,
    );
    expect(outcome.pairs).toHaveLength(0);
  });

  it('ne marie pas deux modes differents', () => {
    const outcome = pairTickets(
      [ticket({ playerId: 'p1', mode: 'ranked' }), ticket({ playerId: 'p2', mode: 'casual' })],
      0,
    );
    expect(outcome.pairs).toHaveLength(0);
  });

  it('ne marie pas deux regions differentes', () => {
    const outcome = pairTickets(
      [ticket({ playerId: 'p1', region: 'eu' }), ticket({ playerId: 'p2', region: 'na' })],
      0,
    );
    expect(outcome.pairs).toHaveLength(0);
  });

  /** « Un worker apparie les tickets par ordre d'anciennete » (docs/05). */
  it('sert le plus ancien d abord', () => {
    const outcome = pairTickets(
      [
        ticket({ playerId: 'recent', mmr: 1000, enqueuedAtMs: 3_000 }),
        ticket({ playerId: 'ancien', mmr: 1000, enqueuedAtMs: 1_000 }),
        ticket({ playerId: 'moyen', mmr: 1000, enqueuedAtMs: 2_000 }),
      ],
      10_000,
    );
    expect(outcome.pairs).toHaveLength(1);
    expect(outcome.pairs[0]!.a.playerId).toBe('ancien');
    expect(outcome.waiting.map((t) => t.playerId)).toEqual(['recent']);
  });

  /** A anciennete egale de traitement, le MMR le plus proche gagne. */
  it('choisit le MMR le plus proche parmi les candidats acceptables', () => {
    const outcome = pairTickets(
      [
        ticket({ playerId: 'p1', mmr: 1000, enqueuedAtMs: 0 }),
        ticket({ playerId: 'loin', mmr: 1040, enqueuedAtMs: 0 }),
        ticket({ playerId: 'proche', mmr: 1005, enqueuedAtMs: 0 }),
      ],
      0,
    );
    expect(outcome.pairs[0]!.b.playerId).toBe('proche');
  });

  it('forme plusieurs paires en un seul tour', () => {
    const outcome = pairTickets(
      [
        ticket({ playerId: 'p1', mmr: 1000, enqueuedAtMs: 0 }),
        ticket({ playerId: 'p2', mmr: 1010, enqueuedAtMs: 1 }),
        ticket({ playerId: 'p3', mmr: 2000, enqueuedAtMs: 2 }),
        ticket({ playerId: 'p4', mmr: 2010, enqueuedAtMs: 3 }),
      ],
      0,
    );
    expect(outcome.pairs).toHaveLength(2);
    expect(outcome.waiting).toHaveLength(0);
  });

  it('ne marie jamais un joueur avec lui-meme', () => {
    const outcome = pairTickets([ticket({ playerId: 'p1' }), ticket({ playerId: 'p1' })], 0);
    expect(outcome.pairs).toHaveLength(0);
  });

  describe('adversaires recents', () => {
    it('prefere un autre adversaire quand il y en a un', () => {
      const outcome = pairTickets(
        [
          ticket({ playerId: 'p1', mmr: 1000, enqueuedAtMs: 0, recentOpponents: ['p2'] }),
          ticket({ playerId: 'p2', mmr: 1001, enqueuedAtMs: 1, recentOpponents: ['p1'] }),
          ticket({ playerId: 'p3', mmr: 1020, enqueuedAtMs: 2 }),
        ],
        0,
      );
      expect(outcome.pairs).toHaveLength(1);
      expect([outcome.pairs[0]!.a.playerId, outcome.pairs[0]!.b.playerId].sort()).toEqual([
        'p1',
        'p3',
      ]);
    });

    /**
     * « Quand c'est possible » (docs/05) : a deux dans la file, la revanche
     * immediate vaut mieux qu'une attente sans fin.
     */
    it('reprend le meme adversaire quand il n y en a pas d autre', () => {
      const outcome = pairTickets(
        [
          ticket({ playerId: 'p1', recentOpponents: ['p2'] }),
          ticket({ playerId: 'p2', recentOpponents: ['p1'] }),
        ],
        0,
      );
      expect(outcome.pairs).toHaveLength(1);
    });
  });

  describe('proprietes', () => {
    /**
     * Personne ne disparait et personne ne double.
     *
     * C'est l'invariant qui protege des deux defauts les plus couteux : un
     * joueur apparie deux fois se retrouverait assis a deux matchs, un joueur
     * perdu attendrait indefiniment devant un ecran de recherche.
     */
    it('conserve exactement les tickets recus, sans doublon', () => {
      const ticketArb = fc.record({
        playerId: fc.string({ minLength: 1, maxLength: 4 }),
        mmr: fc.integer({ min: 0, max: 3_000 }),
        enqueuedAtMs: fc.integer({ min: 0, max: 60_000 }),
        mode: fc.constantFrom<QueueMode>('ranked', 'casual'),
      });

      fc.assert(
        fc.property(
          fc.uniqueArray(ticketArb, { maxLength: 12, selector: (t) => t.playerId }),
          fc.integer({ min: 0, max: 120_000 }),
          (raw, now) => {
            const tickets = raw.map((t) => ticket(t));
            const outcome = pairTickets(tickets, now);

            const placed = [
              ...outcome.pairs.flatMap((p) => [p.a.playerId, p.b.playerId]),
              ...outcome.waiting.map((t) => t.playerId),
            ];
            expect(placed.sort()).toEqual(tickets.map((t) => t.playerId).sort());
            expect(new Set(placed).size).toBe(placed.length);
          },
        ),
      );
    });

    /** Une paire formee respecte toujours les deux fenetres. */
    it('ne forme que des paires acceptables des deux cotes', () => {
      const ticketArb = fc.record({
        playerId: fc.string({ minLength: 1, maxLength: 4 }),
        mmr: fc.integer({ min: 0, max: 3_000 }),
        enqueuedAtMs: fc.integer({ min: 0, max: 60_000 }),
      });

      fc.assert(
        fc.property(
          fc.uniqueArray(ticketArb, { maxLength: 12, selector: (t) => t.playerId }),
          fc.integer({ min: 0, max: 120_000 }),
          (raw, now) => {
            const outcome = pairTickets(
              raw.map((t) => ticket(t)),
              now,
            );
            for (const pair of outcome.pairs) {
              const gap = Math.abs(pair.a.mmr - pair.b.mmr);
              expect(gap).toBeLessThanOrEqual(searchRange(now - pair.a.enqueuedAtMs));
              expect(gap).toBeLessThanOrEqual(searchRange(now - pair.b.enqueuedAtMs));
              expect(pair.a.mode).toBe(pair.b.mode);
              expect(pair.a.region).toBe(pair.b.region);
            }
          },
        ),
      );
    });
  });
});
