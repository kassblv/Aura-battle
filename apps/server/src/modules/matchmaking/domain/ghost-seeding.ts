import {
  AI_PROFILES,
  BALANCE,
  deriveSeed,
  simulateProfileMatch,
  type AiProfileId,
  type BalanceConfig,
  type PlayedRound,
} from '@aura/rules';
import { GHOST_FALLBACK_MS, SEED_GHOST_PREFIX, type GhostRound } from './ghost.js';
import { searchRange } from './pairing.js';

/**
 * Amorcage du vivier de fantomes (docs/05 § « Fantomes »).
 *
 * **Le probleme que ce module existe pour resoudre.** Un enregistrement ne nait
 * que d'un match classe entre deux humains. Le jour du lancement il n'y en a
 * aucun — donc la fonctionnalite qui existe pour empecher une file vide ne
 * marche pas quand la file est vide. C'est precisement le moment ou on en a
 * besoin, et c'est le premier match de chaque joueur qui en depend.
 *
 * La regle « on n'enregistre que des matchs humains » n'est pas relachee pour
 * autant : elle empeche un rejeu de servir de modele au suivant, et donc le
 * niveau de la file de deriver de copie en copie. Ce qu'on amorce ici est une
 * **reserve de depart**, produite hors ligne a partir des profils de l'IA solo
 * (`packages/rules/src/ai`), et que `selectGhost` traite comme un dernier
 * recours : des qu'un enregistrement humain convient, c'est lui qui joue.
 *
 * Tout est pur et deterministe : meme version des regles, meme reserve. Une
 * reserve qu'on ne peut pas regenerer a l'identique n'est pas reproductible, et
 * un desequilibre constate en production ne serait plus explicable.
 */

/**
 * Identifiant d'origine d'un enregistrement amorce. Lisible a l'oeil nu.
 *
 * Il se retrouve tel quel dans `MatchSeat.ghostOfId` : une ligne de match dit
 * donc d'elle-meme que l'adversaire etait un fantome d'amorcage, et a quel
 * niveau. Le prefixe et son predicat vivent dans `ghost.ts`, avec le reste de
 * ce qui decrit un enregistrement.
 */
export function seedGhostPlayerId(profile: AiProfileId, mmr: number, variant: number): string {
  return `${SEED_GHOST_PREFIX}${profile}:${String(mmr)}:${String(variant)}`;
}

/**
 * Ecart entre deux niveaux de la reserve, en points de MMR.
 *
 * La contrainte vient de `selectGhost`, qui refuse un ecart superieur a la
 * fenetre de recherche. Celle-ci plafonne a `SEARCH_WINDOW.maxRange` (±400) et
 * l'a atteint bien avant la bascule — a 25 s d'attente elle y est depuis onze
 * secondes. **C'est donc 400, et pas davantage, qui doit etre couvert**, quelle
 * que soit la patience du joueur.
 *
 * Un pas de 200 laisse au pire 100 points d'ecart avec le niveau le plus
 * proche : la bascule se declenche a la premiere tentative, et l'adversaire
 * annonce est proche du niveau reel du joueur plutot que juste tolerable.
 */
export const SEED_GHOST_MMR_STEP = 200;

/**
 * Bornes de la reserve.
 *
 * Le MMR de depart est 1000 et il ne descend jamais sous zero (`nextMmr`). Le
 * bas de la plage couvre donc tout le monde : 200 − 400 est deja negatif.
 *
 * Le haut est un choix assume. 2600 + 400 couvre jusqu'a 3000, soit une
 * quatre-vingtaine de victoires d'affilee depuis 1000 a K = 24. **Au-dela, la
 * reserve ne couvre plus** — mais personne n'y arrive avant que la reserve
 * reelle ne soit largement fournie, et un joueur a ce niveau-la n'a de toute
 * facon rien a apprendre d'un fantome d'IA.
 */
export const SEED_GHOST_MMR = { min: 200, max: 2_600 } as const;

/**
 * Nombre d'enregistrements par niveau.
 *
 * Un seul suffirait a ne jamais rendre `null`. Trois existent pour la
 * **variete** : un joueur isole au lancement relance plusieurs recherches de
 * suite, et rencontrer trois fois de suite exactement les memes trois manches
 * est le genre de detail qui fait reposer le telephone. `selectGhost` departage
 * les candidats a egalite en tournant avec l'horloge, ce qui les fait alterner.
 */
export const SEED_GHOST_VARIANTS = 3;

/**
 * Profil de l'IA solo joue a chaque niveau.
 *
 * Un fantome annonce a 2400 de MMR doit jouer comme quelqu'un de 2400 : un
 * enregistrement de debutant portant un MMR eleve serait une victoire offerte a
 * qui le croise, et fausserait son classement dans le sens le plus flatteur —
 * exactement ce que `docs/06` surveille dans l'autre sens.
 *
 * Les seuils suivent l'ordre des quatre profils (docs/01 §11). Le MMR de depart
 * — 1000, celui de tout nouveau venu — tombe sur « Le Mysterieux » : correct,
 * et battable. C'est le tout premier adversaire du jeu, il n'a pas a humilier.
 */
export function profileForMmr(mmr: number): AiProfileId {
  if (mmr < 800) return 'rookie';
  if (mmr < 1_200) return 'mystery';
  if (mmr < 1_800) return 'calm';
  return 'untouchable';
}

/** Les niveaux de MMR couverts par la reserve, du plus bas au plus haut. */
export function seedGhostLevels(): readonly number[] {
  const levels: number[] = [];
  for (let mmr = SEED_GHOST_MMR.min; mmr <= SEED_GHOST_MMR.max; mmr += SEED_GHOST_MMR_STEP) {
    levels.push(mmr);
  }
  return levels;
}

/** Un enregistrement de depart, pret a etre ecrit. */
export interface SeedGhostRecording {
  readonly playerId: string;
  readonly mmr: number;
  readonly rulesVersion: string;
  readonly rounds: readonly GhostRound[];
}

/** Ce que le moteur a joue, traduit dans le vocabulaire d'un enregistrement. */
function toGhostRound(played: PlayedRound): GhostRound {
  return {
    move: played.choice.move,
    amplifier: played.choice.amplifier,
    useUltimate: played.choice.useUltimate,
    // Un ecart, jamais un instant : il sera rejoue sur la jauge d'une autre
    // manche, ou un instant ne voudrait rien dire.
    timing: { quality: played.timing.quality, delta: played.timing.delta },
    rechargePoints: played.recharge?.points ?? 0,
    rechargeTaps: played.rechargeTaps,
  };
}

/**
 * Construit la reserve de depart pour cette version des regles.
 *
 * **A relancer apres chaque changement de `RULES_VERSION`.** `selectGhost`
 * exige l'egalite des versions : le jour d'un changement de regles, tous les
 * enregistrements existants — amorces comme reels — deviennent ineligibles d'un
 * coup, et la file se retrouve exactement dans l'etat du jour du lancement. Le
 * seed est idempotent precisement pour qu'on puisse le rejouer a ce moment-la.
 */
export function buildSeedGhosts(
  rulesVersion: string,
  config: BalanceConfig = BALANCE,
): readonly SeedGhostRecording[] {
  const recordings: SeedGhostRecording[] = [];

  for (const mmr of seedGhostLevels()) {
    const profileId = profileForMmr(mmr);
    for (let variant = 1; variant <= SEED_GHOST_VARIANTS; variant += 1) {
      const seed = deriveSeed('ghost-seed', rulesVersion, profileId, mmr, variant);
      const simulation = simulateProfileMatch(seed, AI_PROFILES[profileId], config);

      recordings.push({
        playerId: seedGhostPlayerId(profileId, mmr, variant),
        mmr,
        rulesVersion,
        // Le siege `a` seulement : les deux ont joue le meme profil, et un
        // enregistrement par match suffit a ce niveau.
        rounds: simulation.played.a.map(toGhostRound),
      });
    }
  }

  return recordings;
}

/**
 * Plage de MMR pour laquelle la reserve garantit un adversaire **des la
 * premiere tentative de bascule**.
 *
 * La fenetre applicable n'est pas la meme dans les deux modes : le classe
 * bascule a 25 s, ou elle plafonne deja a ±400, la partie rapide a 12 s, ou
 * elle ne vaut encore que ±350. C'est donc la plus etroite des deux qui fait
 * foi — sinon la garantie serait fausse precisement dans le mode qui bascule le
 * plus tot.
 *
 * Calcule plutot qu'ecrit : une borne recopiee finit par mentir le jour ou le
 * pas, les delais ou la fenetre changent.
 */
export function seedGhostCoverage(): { readonly min: number; readonly max: number } {
  const narrowest = Math.min(
    ...Object.values(GHOST_FALLBACK_MS).map((waitedMs) => searchRange(waitedMs)),
  );
  return { min: SEED_GHOST_MMR.min - narrowest, max: SEED_GHOST_MMR.max + narrowest };
}
