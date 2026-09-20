import { RULES_VERSION } from '@aura/rules';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  GHOST_FALLBACK_MS,
  GHOST_SEAT_PREFIX,
  ghostSeatId,
  isGhostSeatId,
  selectGhost,
  shouldFallBackToGhost,
  type GhostRecording,
  type GhostRound,
} from './ghost.js';
import { searchRange } from './pairing.js';
import { DEFAULT_REGION, type QueueTicket } from './ticket.js';

/**
 * Decision de bascule vers un fantome (docs/05 § « Fantomes »).
 *
 * Module pur, au meme titre que `pairing.ts` : le temps est un parametre, donc
 * une bascule a vingt-cinq secondes se verifie en quelques microsecondes.
 */

const ticket = (over: Partial<QueueTicket> & { playerId: string }): QueueTicket => ({
  mode: 'ranked',
  mmr: 1000,
  enqueuedAtMs: 0,
  region: DEFAULT_REGION,
  recentOpponents: [],
  ...over,
});

const aRound: GhostRound = {
  move: { style: 'calme', tier: 2 },
  amplifier: 1,
  useUltimate: false,
  timing: { quality: 'good', delta: 0.07 },
  rechargePoints: 12,
  rechargeTaps: 14,
};

const recording = (over: Partial<GhostRecording> & { id: string }): GhostRecording => ({
  playerId: `source_${over.id}`,
  mmr: 1000,
  rulesVersion: RULES_VERSION,
  rounds: [aRound, aRound, aRound],
  ...over,
});

describe('shouldFallBackToGhost — quand la file cede la place', () => {
  it('attend vingt-cinq secondes en classe', () => {
    const attendu = ticket({ playerId: 'p', mode: 'ranked' });
    expect(shouldFallBackToGhost(attendu, 24_999)).toBe(false);
    expect(shouldFallBackToGhost(attendu, 25_000)).toBe(true);
  });

  it('cede plus tot en partie rapide', () => {
    const attendu = ticket({ playerId: 'p', mode: 'casual' });
    expect(shouldFallBackToGhost(attendu, 11_999)).toBe(false);
    expect(shouldFallBackToGhost(attendu, 12_000)).toBe(true);
  });

  /** Les deux valeurs sont celles de docs/05 : les changer ferait mentir le document. */
  it('porte exactement les delais du document', () => {
    expect(GHOST_FALLBACK_MS).toEqual({ ranked: 25_000, casual: 12_000 });
  });

  it('compte depuis l entree en file, pas depuis maintenant', () => {
    const attendu = ticket({ playerId: 'p', enqueuedAtMs: 100_000 });
    expect(shouldFallBackToGhost(attendu, 120_000)).toBe(false);
    expect(shouldFallBackToGhost(attendu, 125_000)).toBe(true);
  });
});

describe('ghostSeatId — un fantome n est pas un joueur', () => {
  it('se reconnait a son prefixe', () => {
    const id = ghostSeatId('rec_1', 'nonce');
    expect(id.startsWith(GHOST_SEAT_PREFIX)).toBe(true);
    expect(isGhostSeatId(id)).toBe(true);
  });

  it('change a chaque match, meme pour le meme enregistrement', () => {
    expect(ghostSeatId('rec_1', 'a')).not.toBe(ghostSeatId('rec_1', 'b'));
  });

  it('ne confond pas un identifiant de joueur avec un fantome', () => {
    for (const id of ['p_alice', 'ghost', 'Ghost:1', '', 'm_ghost:1']) {
      expect(isGhostSeatId(id)).toBe(false);
    }
  });
});

describe('selectGhost — lequel opposer', () => {
  const now = 25_000;
  const waiting = ticket({ playerId: 'p_seul', mmr: 1000 });

  it('prend le MMR le plus proche', () => {
    const choisi = selectGhost(
      [
        recording({ id: 'loin', mmr: 1300 }),
        recording({ id: 'proche', mmr: 1010 }),
        recording({ id: 'moyen', mmr: 1100 }),
      ],
      waiting,
      now,
      RULES_VERSION,
    );
    expect(choisi?.id).toBe('proche');
  });

  it('refuse une autre version des regles', () => {
    expect(
      selectGhost([recording({ id: 'vieux', rulesVersion: '0.9.0' })], waiting, now, RULES_VERSION),
    ).toBeNull();
  });

  /** S'affronter soi-meme n'apprend rien, et le joueur reconnaitrait ses manches. */
  it('refuse l enregistrement du joueur lui-meme', () => {
    expect(
      selectGhost([recording({ id: 'moi', playerId: 'p_seul' })], waiting, now, RULES_VERSION),
    ).toBeNull();
  });

  /** Un enregistrement vide serait un adversaire qui ne joue pas : une victoire offerte. */
  it('refuse un enregistrement sans manche', () => {
    expect(
      selectGhost([recording({ id: 'vide', rounds: [] })], waiting, now, RULES_VERSION),
    ).toBeNull();
  });

  it('refuse un ecart que la fenetre de recherche n accepte pas', () => {
    // A 25 s d'attente, la fenetre vaut 50 + 25 x 25 = 400 (plafond).
    expect(searchRange(now)).toBe(400);
    expect(
      selectGhost([recording({ id: 'trop-fort', mmr: 1401 })], waiting, now, RULES_VERSION),
    ).toBeNull();
    expect(
      selectGhost([recording({ id: 'juste', mmr: 1400 })], waiting, now, RULES_VERSION)?.id,
    ).toBe('juste');
  });

  it('prefere un adversaire pas rencontre recemment, meme plus loin en MMR', () => {
    const recent = ticket({ playerId: 'p_seul', mmr: 1000, recentOpponents: ['source_proche'] });
    const choisi = selectGhost(
      [recording({ id: 'proche', mmr: 1005 }), recording({ id: 'loin', mmr: 1200 })],
      recent,
      now,
      RULES_VERSION,
    );
    expect(choisi?.id).toBe('loin');
  });

  /**
   * Une rencontre recente est **reportee**, pas interdite : refuser le seul
   * enregistrement disponible ramenerait la file vide qu'on veut supprimer.
   */
  it('accepte un adversaire recent quand il est le seul', () => {
    const recent = ticket({ playerId: 'p_seul', recentOpponents: ['source_seul'] });
    expect(selectGhost([recording({ id: 'seul' })], recent, now, RULES_VERSION)?.id).toBe('seul');
  });

  /**
   * A egalite parfaite, c'est l'horloge qui tranche — et l'ordre dans lequel la
   * base a rendu ses lignes n'y change rien. Sans ce tri canonique, la rotation
   * ci-dessous dependrait d'un `ORDER BY` et cesserait d'etre reproductible.
   */
  it('rend le meme enregistrement quel que soit l ordre des candidats', () => {
    const candidats = [recording({ id: 'b', mmr: 1050 }), recording({ id: 'a', mmr: 950 })];
    const direct = selectGhost(candidats, waiting, now, RULES_VERSION);
    const inverse = selectGhost([...candidats].reverse(), waiting, now, RULES_VERSION);
    expect(inverse?.id).toBe(direct?.id);
  });

  /**
   * Le defaut que cette rotation ferme : la selection etant deterministe, un
   * joueur seul au lancement rencontrait **le meme** enregistrement a chaque
   * recherche, et rejouait les memes trois manches en boucle.
   */
  it('fait tourner entre des candidats strictement equivalents', () => {
    const candidats = [
      recording({ id: 'un', mmr: 1000 }),
      recording({ id: 'deux', mmr: 1000 }),
      recording({ id: 'trois', mmr: 1000 }),
    ];
    const vus = new Set(
      [0, 1, 2, 3, 4, 5].map(
        (pas) => selectGhost(candidats, waiting, now + pas, RULES_VERSION)?.id,
      ),
    );
    expect(vus.size).toBeGreaterThan(1);
  });

  /** Deux appels au meme instant rendent la meme chose : la fonction reste pure. */
  it('rend la meme chose deux fois au meme instant', () => {
    const candidats = [recording({ id: 'un', mmr: 1000 }), recording({ id: 'deux', mmr: 1000 })];
    expect(selectGhost(candidats, waiting, now, RULES_VERSION)?.id).toBe(
      selectGhost(candidats, waiting, now, RULES_VERSION)?.id,
    );
  });

  /** Un ecart plus court l'emporte toujours sur la rotation. */
  it('ne fait pas tourner entre des candidats d ecarts differents', () => {
    const candidats = [
      recording({ id: 'proche', mmr: 1010 }),
      recording({ id: 'loin', mmr: 1200 }),
    ];
    for (const pas of [0, 1, 2, 3, 500, 1_337]) {
      expect(selectGhost(candidats, waiting, now + pas, RULES_VERSION)?.id).toBe('proche');
    }
  });

  it('ne trouve rien dans une reserve vide', () => {
    expect(selectGhost([], waiting, now, RULES_VERSION)).toBeNull();
  });
});

describe('selectGhost — proprietes', () => {
  const recordingArb = fc.record({
    id: fc.string({ minLength: 1, maxLength: 8 }),
    playerId: fc.string({ minLength: 1, maxLength: 8 }),
    mmr: fc.integer({ min: 0, max: 3_000 }),
    rulesVersion: fc.constantFrom(RULES_VERSION, '0.9.0'),
    rounds: fc.array(fc.constant(aRound), { maxLength: 3 }),
  });

  const ticketArb = fc.record({
    playerId: fc.string({ minLength: 1, maxLength: 8 }),
    mmr: fc.integer({ min: 0, max: 3_000 }),
    enqueuedAtMs: fc.constant(0),
  });

  /**
   * La propriete qui compte : **tout ce que le selecteur rend est jouable**.
   * Un seul de ces quatre refus qui passe, et un joueur se retrouve face a un
   * adversaire d'une autre version, a lui-meme, ou a un fantome inerte.
   */
  it('ne rend jamais un enregistrement inutilisable', () => {
    fc.assert(
      fc.property(
        fc.array(recordingArb, { maxLength: 12 }),
        ticketArb,
        fc.integer({ min: 0, max: 600_000 }),
        (candidats, base, nowMs) => {
          const waiting = ticket(base);
          const choisi = selectGhost(candidats, waiting, nowMs, RULES_VERSION);
          if (choisi === null) return;

          expect(choisi.rulesVersion).toBe(RULES_VERSION);
          expect(choisi.playerId).not.toBe(waiting.playerId);
          expect(choisi.rounds.length).toBeGreaterThan(0);
          expect(Math.abs(choisi.mmr - waiting.mmr)).toBeLessThanOrEqual(searchRange(nowMs));
        },
      ),
    );
  });

  /** Meme entree, meme sortie : deux joueurs du meme niveau ne doivent pas dependre d'un tri. */
  it('rend le meme enregistrement quel que soit l ordre des candidats', () => {
    fc.assert(
      fc.property(
        fc.array(recordingArb, { minLength: 1, maxLength: 12 }),
        ticketArb,
        fc.integer({ min: 0, max: 600_000 }),
        (candidats, base, nowMs) => {
          const waiting = ticket(base);
          const direct = selectGhost(candidats, waiting, nowMs, RULES_VERSION);
          const inverse = selectGhost([...candidats].reverse(), waiting, nowMs, RULES_VERSION);
          expect(inverse?.id ?? null).toBe(direct?.id ?? null);
        },
      ),
    );
  });

  /**
   * Il existe un candidat acceptable, donc le selecteur doit en rendre un.
   * L'inverse — rendre `null` alors qu'un fantome etait jouable — laisse un
   * joueur seul devant son ecran, ce que cette fonctionnalite existe pour
   * empecher.
   */
  it('rend toujours quelque chose quand un candidat est acceptable', () => {
    fc.assert(
      fc.property(
        fc.array(recordingArb, { minLength: 1, maxLength: 12 }),
        ticketArb,
        fc.integer({ min: 0, max: 600_000 }),
        (candidats, base, nowMs) => {
          const waiting = ticket(base);
          const acceptable = candidats.some(
            (candidat) =>
              candidat.rulesVersion === RULES_VERSION &&
              candidat.playerId !== waiting.playerId &&
              candidat.rounds.length > 0 &&
              Math.abs(candidat.mmr - waiting.mmr) <= searchRange(nowMs),
          );
          expect(selectGhost(candidats, waiting, nowMs, RULES_VERSION) !== null).toBe(acceptable);
        },
      ),
    );
  });
});
