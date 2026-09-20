import type { Seat } from '@aura/rules';

/**
 * Calcul du classement (docs/05-matchmaking-ranking.md « MMR et ligues »,
 * jalon M5, ADR 0010).
 *
 * Module pur, au meme titre que `@aura/rules` : aucune horloge, aucun Redis,
 * aucun Prisma. Ce n'est **pas** `@aura/rules` pour autant — voir ADR 0010,
 * qui tranche ce choix d'emplacement en meme temps que Elo contre Glicko-2.
 * Ce qui se joue ici concerne une **suite** de matchs sur une saison, pas la
 * physique d'un duel : le moteur de regles ne sait rien d'un joueur au-dela
 * d'un siege, et ne doit rien en savoir.
 */

/**
 * Ligues visibles (docs/05), dans l'ordre croissant.
 *
 * Identifiants stables transportes tels quels sur le reseau — `match:found`
 * et `match:end` ne portent qu'une chaine (`z.string()`) — pour que le client
 * les traduise via ses propres cles i18n plutot que de recevoir un libelle
 * francais fige cote serveur (CLAUDE.md, regle des langues).
 */
export type League = 'sans_aura' | 'naissante' | 'stable' | 'rayonnante' | 'legendaire' | 'infinie';

/** Seuils de points de ligue (LP) par palier (docs/05). */
const LEAGUE_THRESHOLDS: readonly { readonly minLp: number; readonly league: League }[] = [
  { minLp: 0, league: 'sans_aura' },
  { minLp: 100, league: 'naissante' },
  { minLp: 400, league: 'stable' },
  { minLp: 1_000, league: 'rayonnante' },
  { minLp: 2_500, league: 'legendaire' },
  { minLp: 6_000, league: 'infinie' },
];

/** Ligue correspondant a un nombre de points de ligue. Pure fonction de seuils. */
export function leagueFor(leaguePoints: number): League {
  let current: League = 'sans_aura';
  for (const tier of LEAGUE_THRESHOLDS) {
    if (leaguePoints < tier.minLp) break;
    current = tier.league;
  }
  return current;
}

/** Ce que porte la ligne `Rating` d'un joueur pour une saison (docs/04). */
export interface RatingSnapshot {
  readonly mmr: number;
  /**
   * Deviation de classement. Conservee telle quelle : Elo ne s'en sert pas
   * (ADR 0010). Le champ reste au repos pour une eventuelle bascule Glicko-2,
   * sans migration de schema le jour venu.
   */
  readonly rd: number;
  readonly leaguePoints: number;
  readonly league: League;
  /** Matchs classes joues cette saison, plafonne a `PLACEMENT_MATCHES`. */
  readonly placements: number;
  readonly wins: number;
  readonly losses: number;
}

/** Classement de depart d'un joueur sans ligne en base (docs/05 : MMR 1000). */
export const STARTING_RATING: RatingSnapshot = Object.freeze({
  mmr: 1_000,
  rd: 350,
  leaguePoints: 0,
  league: 'sans_aura',
  placements: 0,
  wins: 0,
  losses: 0,
});

/** Nombre de matchs de placement par saison (docs/05). */
export const PLACEMENT_MATCHES = 5;

/**
 * K majore durant les placements, pour converger vite avant de se stabiliser
 * — le role que jouerait une deviation elevee sous Glicko-2 (ADR 0010).
 */
const K_PLACEMENT = 60;
const K_NORMAL = 24;

/** Etalement Elo standard : 400 points d'ecart valent 10 contre 1 a l'issue. */
const ELO_SPREAD = 400;

function expectedScore(mmr: number, opponentMmr: number): number {
  return 1 / (1 + 10 ** ((opponentMmr - mmr) / ELO_SPREAD));
}

/** Issue d'un match, du point de vue du classement (le forfait compte comme une defaite). */
export type RatingOutcome = 'win' | 'loss' | 'draw';

function actualScore(outcome: RatingOutcome): number {
  return outcome === 'win' ? 1 : outcome === 'draw' ? 0.5 : 0;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** K applique a ce joueur pour son prochain match classe. */
function kFactorFor(placementsPlayed: number): number {
  return placementsPlayed < PLACEMENT_MATCHES ? K_PLACEMENT : K_NORMAL;
}

/**
 * Prochain MMR (Elo a K variable, ADR 0010).
 *
 * Zero-somme entre deux joueurs qui partagent le meme K — c'est le cas des
 * qu'aucun des deux n'est plus en placement — puisque
 * `expectedScore(a, b) + expectedScore(b, a) = 1`. Borne par construction :
 * l'ecart entre score reel et score attendu ne depasse jamais 1, le delta ne
 * depasse donc jamais `K_PLACEMENT`.
 */
export function nextMmr(
  mmr: number,
  opponentMmr: number,
  outcome: RatingOutcome,
  placementsPlayed: number,
): number {
  const delta =
    kFactorFor(placementsPlayed) * (actualScore(outcome) - expectedScore(mmr, opponentMmr));
  return Math.max(0, Math.round(mmr + delta));
}

/** Base des points de ligue gagnes ou perdus (docs/05 : « base +-20 »). */
const BASE_LP = 20;
/** Poids de la correction MMR/LP. */
const LP_CORRECTION_FACTOR = 0.1;
/**
 * Correction maximale, volontairement plus petite que `BASE_LP` : un
 * vainqueur ne doit jamais repartir avec un delta negatif ou nul, ni un
 * perdant avec un delta positif ou nul (docs/05, section « ce que je veux »).
 */
const MAX_LP_CORRECTION = 10;
/** MMR 1000 (depart) correspond a 0 LP (Sans aura) : meme echelle, decalee. */
const MMR_LP_OFFSET = 1_000;

/**
 * Points de ligue qu'un MMR implique, sur l'echelle ci-dessus.
 *
 * C'est la meme conversion que celle de `nextLeaguePoints`, nommee une fois :
 * elle sert aussi a dire **quelle ligue montrer pour un fantome**, qui n'a pas
 * de ligne de classement a lui (docs/05 § « Fantomes »). Un enregistrement ne
 * porte que le MMR de son auteur ; en deduire une ligue par la conversion que
 * le classement utilise deja vaut mieux que d'afficher « Sans aura » a tous les
 * fantomes, ou d'inventer une seconde echelle.
 */
export function impliedLeaguePoints(mmr: number): number {
  return Math.max(0, mmr - MMR_LP_OFFSET);
}

/** Ligue impliquee par un MMR, pour qui n'a pas de LP a montrer (fantome). */
export function leagueForMmr(mmr: number): League {
  return leagueFor(impliedLeaguePoints(mmr));
}

/**
 * Part des LP habituels qu'un match contre un fantome rapporte (docs/05).
 *
 * « Un match contre un fantome rapporte 50 % des LP habituels. » La reduction
 * s'applique au **delta**, base et correction comprises, et pas au total :
 * multiplier des LP acquis reviendrait a punir retroactivement tout ce que le
 * joueur a gagne avant.
 */
export const GHOST_LEAGUE_POINTS_MULTIPLIER = 0.5;

/**
 * Prochains points de ligue.
 *
 * Base +-20 (docs/05), corrigee par l'ecart entre le MMR **d'avant ce match**
 * et les LP actuels : un joueur sous-classe (son MMR implique plus de LP qu'il
 * n'en a) gagne plus et perd moins jusqu'a rattraper son niveau ; un joueur
 * sur-classe fait le chemin inverse. La correction se lit sur le MMR d'avant
 * le match, jamais celui d'apres : sinon le resultat du match amplifierait sa
 * propre correction, et gagner ferait gagner encore plus d'avoir gagne.
 *
 * Une seule formule couvre victoire, defaite et nul : `actualScore` vaut 1,
 * 0 ou 0.5, et `(2 * actualScore - 1)` vaut donc +1, -1 ou 0 — le signe du
 * `BASE_LP` a appliquer, la correction s'ajoutant dans tous les cas.
 *
 * `multiplier` est la part des LP habituels que ce match rapporte : 1 pour un
 * duel entre humains, `GHOST_LEAGUE_POINTS_MULTIPLIER` contre un fantome
 * (docs/05). Il s'applique au delta entier — base et correction — puis on
 * arrondit : reduire la base sans reduire la correction laisserait la seconde
 * peser deux fois plus lourd qu'elle ne le doit, et pourrait inverser le signe
 * d'un resultat.
 */
export function nextLeaguePoints(
  mmrBefore: number,
  leaguePoints: number,
  outcome: RatingOutcome,
  multiplier = 1,
): number {
  const gap = impliedLeaguePoints(mmrBefore) - leaguePoints;
  const correction = clamp(gap * LP_CORRECTION_FACTOR, -MAX_LP_CORRECTION, MAX_LP_CORRECTION);
  const delta = Math.round(((2 * actualScore(outcome) - 1) * BASE_LP + correction) * multiplier);
  return Math.max(0, leaguePoints + delta);
}

/**
 * Issue d'un match du point de vue d'un siege, telle que `@aura/rules` la
 * rend : `winner` et `reason` de `MatchResult`, sans rien importer de plus.
 */
export interface MatchOutcomeInput {
  readonly winner: Seat | null;
  readonly reason: string;
}

/**
 * Vrai quand les deux sieges ont abandonne (`afterReveal`, `@aura/rules`) : ni
 * l'un ni l'autre n'a joue la manche qui a mis fin au match. Aucun des deux ne
 * doit voir son classement bouger pour un match que personne n'a dispute —
 * seul un abandon **seul** est une defaite (docs/05, anti-ferme).
 */
export function isMutualForfeit(result: MatchOutcomeInput): boolean {
  return result.reason === 'forfeit' && result.winner === null;
}

/**
 * Issue de classement pour un siege : victoire, defaite, nul, ou abandon.
 *
 * Distincte de `RatingOutcome` : le classement traite un abandon comme une
 * defaite (`nextRating` le fait ci-dessous), mais les recompenses doivent
 * pouvoir le distinguer d'une defaite jouee jusqu'au bout (`rewardsFor`).
 */
export type MatchOutcome = 'win' | 'loss' | 'draw' | 'forfeited';

/** Issue de classement d'un siege pour ce resultat de match. */
export function outcomeFor(seat: Seat, result: MatchOutcomeInput): MatchOutcome {
  if (result.reason === 'forfeit') {
    if (result.winner === null) return 'forfeited';
    return result.winner === seat ? 'win' : 'forfeited';
  }
  if (result.winner === null) return 'draw';
  return result.winner === seat ? 'win' : 'loss';
}

/**
 * Applique un resultat classe a un classement.
 *
 * Le forfait compte comme une defaite pour le MMR et les LP : sans cela,
 * abandonner ne couterait rien de plus qu'un ecran ferme plus tot, et un
 * joueur en difficulte n'aurait aucune raison de finir la manche plutot que
 * de fuir. Seules les recompenses distinguent le forfait d'une defaite jouee
 * (`rewardsFor`), pour ne pas punir deux fois le meme abandon.
 *
 * `leaguePointsMultiplier` ne touche **que** les LP. Contre un fantome, docs/05
 * reduit de moitie ce que le match rapporte — il ne dit rien du MMR, et le MMR
 * n'a aucune raison de bouger differemment : l'enregistrement porte le MMR reel
 * d'un joueur reel, et c'est bien contre ce niveau-la qu'on vient de jouer.
 */
export function nextRating(
  rating: RatingSnapshot,
  opponentMmr: number,
  outcome: MatchOutcome,
  options: { readonly leaguePointsMultiplier?: number } = {},
): RatingSnapshot {
  const ratingOutcome: RatingOutcome = outcome === 'forfeited' ? 'loss' : outcome;
  const mmr = nextMmr(rating.mmr, opponentMmr, ratingOutcome, rating.placements);
  const leaguePoints = nextLeaguePoints(
    rating.mmr,
    rating.leaguePoints,
    ratingOutcome,
    options.leaguePointsMultiplier ?? 1,
  );

  return {
    mmr,
    rd: rating.rd,
    leaguePoints,
    league: leagueFor(leaguePoints),
    placements: Math.min(PLACEMENT_MATCHES, rating.placements + 1),
    wins: rating.wins + (ratingOutcome === 'win' ? 1 : 0),
    losses: rating.losses + (ratingOutcome === 'loss' ? 1 : 0),
  };
}

export interface Rewards {
  readonly softCurrency: number;
  readonly xp: number;
}

/**
 * Bareme des recompenses (docs/05 « Recompenses »).
 *
 * Cosmetique uniquement au bout de la chaine (ADR 0003) : ce que `softCurrency`
 * achete ne change jamais un score. Le forfait rapporte strictement zero,
 * en-dessous meme d'une defaite jouee — sans ce plancher a zero, la boucle
 * « rejoindre, abandonner, recommencer » deviendrait plus rentable que jouer,
 * et rapporterait sans le moindre risque de defaite prolongee.
 */
const REWARDS: Readonly<Record<MatchOutcome, Rewards>> = {
  win: { softCurrency: 20, xp: 30 },
  draw: { softCurrency: 12, xp: 18 },
  loss: { softCurrency: 8, xp: 12 },
  forfeited: { softCurrency: 0, xp: 0 },
};

export function rewardsFor(outcome: MatchOutcome): Rewards {
  return REWARDS[outcome];
}
