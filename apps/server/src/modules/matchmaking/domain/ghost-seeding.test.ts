import { AI_PROFILES, RULES_VERSION } from '@aura/rules';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  GHOST_FALLBACK_MS,
  isSeedGhost,
  SEED_GHOST_PREFIX,
  selectGhost,
  type GhostRecording,
} from './ghost.js';
import {
  buildSeedGhosts,
  profileForMmr,
  SEED_GHOST_MMR,
  SEED_GHOST_MMR_STEP,
  SEED_GHOST_VARIANTS,
  seedGhostCoverage,
  seedGhostLevels,
  seedGhostPlayerId,
} from './ghost-seeding.js';
import { searchRange } from './pairing.js';
import { DEFAULT_MMR, DEFAULT_REGION, type QueueMode, type QueueTicket } from './ticket.js';

/**
 * Amorcage du vivier de fantomes (docs/05 § « Fantomes »).
 *
 * Ce qui se joue ici tient en une phrase : **le jour du lancement, un joueur
 * seul doit obtenir un adversaire.** Tout le reste de la fonctionnalite peut
 * etre parfait, si la reserve est vide au premier lancement elle ne sert a
 * rien — et c'est le premier match de chaque joueur qui est en cause.
 */

/**
 * La reserve, construite **une fois** pour toute la suite.
 *
 * Trente-neuf matchs simules : c'est instantane, mais le refaire a chaque
 * execution d'une propriete `fast-check` ne prouverait rien de plus.
 */
const POOL: readonly GhostRecording[] = buildSeedGhosts(RULES_VERSION).map((recording) => ({
  // En base, l'identifiant est un UUID genere a l'insertion ; `selectGhost` ne
  // s'en sert que pour departager, donc l'identifiant d'origine suffit ici.
  id: recording.playerId,
  playerId: recording.playerId,
  mmr: recording.mmr,
  rulesVersion: recording.rulesVersion,
  rounds: recording.rounds,
}));

const ticket = (over: Partial<QueueTicket> = {}): QueueTicket => ({
  playerId: 'p_seul',
  mode: 'ranked',
  mmr: DEFAULT_MMR,
  enqueuedAtMs: 0,
  region: DEFAULT_REGION,
  recentOpponents: [],
  ...over,
});

describe('la reserve de depart', () => {
  it('couvre chaque niveau avec plusieurs enregistrements', () => {
    expect(seedGhostLevels()[0]).toBe(SEED_GHOST_MMR.min);
    expect(seedGhostLevels().at(-1)).toBe(SEED_GHOST_MMR.max);
    expect(POOL).toHaveLength(seedGhostLevels().length * SEED_GHOST_VARIANTS);
  });

  it('avance par pas reguliers', () => {
    const levels = seedGhostLevels();
    for (let index = 1; index < levels.length; index += 1) {
      expect(levels[index]! - levels[index - 1]!).toBe(SEED_GHOST_MMR_STEP);
    }
  });

  /**
   * La contrainte qui dimensionne tout le reste : `selectGhost` refuse un ecart
   * superieur a la fenetre de recherche. Un pas plus large que **deux** fois la
   * fenetre laisserait des joueurs sans aucun candidat, entre deux niveaux.
   */
  it('avance par un pas que la fenetre de recherche couvre', () => {
    const narrowest = Math.min(
      ...Object.values(GHOST_FALLBACK_MS).map((waitedMs) => searchRange(waitedMs)),
    );
    expect(SEED_GHOST_MMR_STEP).toBeLessThanOrEqual(2 * narrowest);
  });

  it('marque chaque enregistrement comme amorce', () => {
    for (const recording of POOL) {
      expect(isSeedGhost(recording.playerId)).toBe(true);
      expect(recording.playerId.startsWith(SEED_GHOST_PREFIX)).toBe(true);
    }
  });

  it('ne peut pas se confondre avec un joueur reel', () => {
    // `Player.id` est un UUID : il ne commence jamais par le prefixe.
    expect(isSeedGhost('3f2504e0-4f89-11d3-9a0c-0305e82c3301')).toBe(false);
    expect(isSeedGhost('p_alice')).toBe(false);
  });

  it('donne un identifiant distinct a chaque enregistrement', () => {
    expect(new Set(POOL.map((recording) => recording.playerId)).size).toBe(POOL.length);
  });

  it('porte la version des regles pour laquelle il a ete produit', () => {
    for (const recording of POOL) {
      expect(recording.rulesVersion).toBe(RULES_VERSION);
    }
  });

  /** Un enregistrement vide est refuse par `selectGhost` : il n'en faut aucun. */
  it('ne produit jamais un enregistrement sans manche', () => {
    for (const recording of POOL) {
      expect(recording.rounds.length).toBeGreaterThan(0);
    }
  });

  it('produit des manches que le moteur accepterait', () => {
    for (const recording of POOL) {
      for (const round of recording.rounds) {
        expect(round.move.tier).toBeGreaterThanOrEqual(0);
        expect(round.move.tier).toBeLessThanOrEqual(4);
        expect(round.amplifier).toBeGreaterThanOrEqual(0);
        expect(round.amplifier).toBeLessThanOrEqual(4);
        expect(round.timing.delta).toBeGreaterThanOrEqual(0);
        expect(round.timing.delta).toBeLessThanOrEqual(1);
        expect(round.rechargeTaps).toBeGreaterThanOrEqual(0);
      }
    }
  });

  /**
   * Une reserve qu'on ne peut pas regenerer a l'identique n'est pas
   * reproductible : un desequilibre constate en production ne serait plus
   * explicable, et rejouer le seed changerait les adversaires de tout le monde.
   */
  it('se regenere a l identique', () => {
    expect(buildSeedGhosts(RULES_VERSION)).toEqual(buildSeedGhosts(RULES_VERSION));
  });

  it('change avec la version des regles', () => {
    expect(buildSeedGhosts('9.9.9')).not.toEqual(buildSeedGhosts(RULES_VERSION));
  });
});

describe('profileForMmr — un fantome joue le niveau qu il annonce', () => {
  it('suit l ordre des quatre profils', () => {
    expect(profileForMmr(200)).toBe('rookie');
    expect(profileForMmr(1_000)).toBe('mystery');
    expect(profileForMmr(1_400)).toBe('calm');
    expect(profileForMmr(2_600)).toBe('untouchable');
  });

  /** Le tout premier adversaire du jeu : correct, et battable. */
  it('donne un adversaire intermediaire au MMR de depart', () => {
    const profile = AI_PROFILES[profileForMmr(DEFAULT_MMR)];
    expect(profile.skill.perfect).toBeLessThan(AI_PROFILES.untouchable.skill.perfect);
    expect(profile.skill.perfect).toBeGreaterThan(AI_PROFILES.rookie.skill.perfect);
  });

  /**
   * Un enregistrement de debutant portant un MMR eleve serait une victoire
   * offerte, et fausserait le classement de qui le croise dans le sens le plus
   * flatteur. L'adresse au timing doit donc croitre avec le niveau annonce.
   */
  it('ne redescend jamais en adresse quand le MMR monte', () => {
    const levels = seedGhostLevels();
    for (let index = 1; index < levels.length; index += 1) {
      const lower = AI_PROFILES[profileForMmr(levels[index - 1]!)];
      const higher = AI_PROFILES[profileForMmr(levels[index]!)];
      expect(higher.skill.perfect).toBeGreaterThanOrEqual(lower.skill.perfect);
      expect(higher.aggression).toBeGreaterThanOrEqual(lower.aggression);
    }
  });

  it('nomme un profil qui existe, pour n importe quel MMR', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 10_000 }), (mmr) => {
        expect(AI_PROFILES[profileForMmr(mmr)]).toBeDefined();
      }),
    );
  });
});

describe('le jour du lancement — la reserve seule suffit', () => {
  const modes: readonly QueueMode[] = ['ranked', 'casual'];

  /**
   * **Le test qui compte.** Base fraiche, aucun match humain joue : un joueur
   * qui attend le delai de son mode doit obtenir un adversaire, quel que soit
   * son niveau dans la plage couverte.
   */
  it('trouve un adversaire pour tout joueur de la plage couverte', () => {
    const coverage = seedGhostCoverage();

    fc.assert(
      fc.property(
        fc.integer({ min: Math.max(0, coverage.min), max: coverage.max }),
        fc.constantFrom(...modes),
        (mmr, mode) => {
          const waiting = ticket({ mmr, mode });
          const chosen = selectGhost(POOL, waiting, GHOST_FALLBACK_MS[mode], RULES_VERSION);
          expect(chosen).not.toBeNull();
        },
      ),
    );
  });

  it('trouve un adversaire au MMR de depart, des la bascule', () => {
    const chosen = selectGhost(
      POOL,
      ticket({ mmr: DEFAULT_MMR }),
      GHOST_FALLBACK_MS.ranked,
      RULES_VERSION,
    );
    expect(chosen?.mmr).toBe(DEFAULT_MMR);
  });

  it('choisit un adversaire du niveau annonce', () => {
    const coverage = seedGhostCoverage();

    fc.assert(
      fc.property(fc.integer({ min: Math.max(0, coverage.min), max: coverage.max }), (mmr) => {
        const chosen = selectGhost(POOL, ticket({ mmr }), GHOST_FALLBACK_MS.ranked, RULES_VERSION);
        expect(chosen).not.toBeNull();
        /**
         * A l'interieur des paliers, **un demi-pas au pire** : la reserve
         * avance regulierement, donc le niveau le plus proche n'est jamais
         * loin. Au-dela des bornes, l'ecart croit jusqu'a la fenetre de
         * recherche — et pas plus, sinon `selectGhost` n'aurait rien rendu.
         */
        const dansLesPaliers = mmr >= SEED_GHOST_MMR.min && mmr <= SEED_GHOST_MMR.max;
        expect(Math.abs(chosen!.mmr - mmr)).toBeLessThanOrEqual(
          dansLesPaliers ? SEED_GHOST_MMR_STEP / 2 : searchRange(GHOST_FALLBACK_MS.ranked),
        );
      }),
    );
  });

  /**
   * Trois enregistrements par niveau n'auraient aucun interet si la selection
   * rendait toujours le meme : un joueur seul au lancement relance plusieurs
   * recherches d'affilee, et rejouerait les memes trois manches en boucle.
   */
  it('fait alterner les enregistrements d un meme niveau', () => {
    const vus = new Set<string>();
    for (let tick = 0; tick < 12; tick += 1) {
      const nowMs = GHOST_FALLBACK_MS.ranked + tick * 500;
      const chosen = selectGhost(POOL, ticket({ mmr: DEFAULT_MMR }), nowMs, RULES_VERSION);
      if (chosen !== null) vus.add(chosen.id);
    }
    expect(vus.size).toBeGreaterThan(1);
  });

  it('ne sert a rien pour une autre version des regles', () => {
    expect(selectGhost(POOL, ticket(), GHOST_FALLBACK_MS.ranked, 'une-autre-version')).toBeNull();
  });
});

describe('les amorces s effacent devant les vrais enregistrements', () => {
  const human: GhostRecording = {
    id: 'rec_humain',
    playerId: 'p_humain',
    mmr: DEFAULT_MMR + 150,
    rulesVersion: RULES_VERSION,
    rounds: POOL[0]!.rounds,
  };

  /**
   * Un fantome d'IA est moins bon qu'un fantome humain : le garder au premier
   * rang plafonnerait la qualite de ce que rencontre un joueur isole. C'est
   * aussi ce qui **retire** les amorces sans avoir a les supprimer.
   */
  it('prefere un enregistrement humain, meme plus loin en MMR', () => {
    const chosen = selectGhost(
      [...POOL, human],
      ticket({ mmr: DEFAULT_MMR }),
      GHOST_FALLBACK_MS.ranked,
      RULES_VERSION,
    );
    expect(chosen?.playerId).toBe('p_humain');
  });

  it('retombe sur une amorce quand aucun humain ne convient', () => {
    const chosen = selectGhost(
      [...POOL, { ...human, rulesVersion: '0.0.1' }],
      ticket({ mmr: DEFAULT_MMR }),
      GHOST_FALLBACK_MS.ranked,
      RULES_VERSION,
    );
    expect(chosen).not.toBeNull();
    expect(isSeedGhost(chosen!.playerId)).toBe(true);
  });

  /**
   * Le vivier reel finit par couvrir tous les niveaux : les amorces ne sont
   * alors plus jamais choisies, sans qu'aucune tache de nettoyage n'ait tourne.
   */
  it('n est plus jamais choisie quand le vivier reel couvre les niveaux', () => {
    const humans: GhostRecording[] = seedGhostLevels().map((mmr, index) => ({
      id: `rec_${String(index)}`,
      playerId: `p_${String(index)}`,
      mmr,
      rulesVersion: RULES_VERSION,
      rounds: POOL[0]!.rounds,
    }));

    const coverage = seedGhostCoverage();
    fc.assert(
      fc.property(fc.integer({ min: Math.max(0, coverage.min), max: coverage.max }), (mmr) => {
        const chosen = selectGhost(
          [...POOL, ...humans],
          ticket({ mmr }),
          GHOST_FALLBACK_MS.ranked,
          RULES_VERSION,
        );
        expect(chosen).not.toBeNull();
        expect(isSeedGhost(chosen!.playerId)).toBe(false);
      }),
    );
  });
});

describe('seedGhostPlayerId', () => {
  it('se lit a l oeil nu', () => {
    expect(seedGhostPlayerId('calm', 1_400, 2)).toBe('seed:calm:1400:2');
  });

  it('distingue les variantes d un meme niveau', () => {
    expect(seedGhostPlayerId('calm', 1_400, 1)).not.toBe(seedGhostPlayerId('calm', 1_400, 2));
  });
});
