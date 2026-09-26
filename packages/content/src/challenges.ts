/**
 * Defis quotidiens (`docs/01-game-design.md` §11).
 *
 * De la DONNEE, comme les animations et les cosmetiques — regle d'or n°5.
 * Ajouter un defi ne demande aucun changement de code, et le catalogue vit
 * ici plutot que sur le serveur parce que le client doit pouvoir nommer et
 * afficher un defi dont le serveur ne lui envoie que la progression.
 *
 * La VALIDATION, elle, reste au serveur : le design le dit, et la regle d'or
 * n°1 l'imposait de toute facon. Ce fichier ne sait pas compter, il sait ce
 * qu'il faut compter.
 */

/** Ce qu'un defi mesure. Les cinq mesures nommees par le game design. */
export type ChallengeMetric = 'counters' | 'perfects' | 'wins' | 'rechargePoints' | 'bestCombo';

/**
 * Comment la progression d'une partie s'ajoute a celle du jour.
 *
 * Un combo est un MAXIMUM : « atteindre un combo de 12 » ne s'obtient pas en
 * cumulant quatre combos de trois. Cumuler un maximum rendrait trivial le
 * defi le plus difficile de la liste, et c'est le genre d'erreur qu'on ne
 * remarque qu'en voyant quelqu'un le valider sans rien avoir reussi.
 */
export type ChallengeAccumulation = 'sum' | 'best';

export interface ChallengeDefinition {
  readonly id: string;
  readonly name: { readonly fr: string };
  readonly metric: ChallengeMetric;
  /** Ce qu'il faut atteindre dans la journee. */
  readonly target: number;
  /** Ce que la journee paie, en monnaie douce. */
  readonly reward: number;
}

/**
 * Comment chaque mesure s'accumule — une propriete de la MESURE, pas du defi.
 *
 * Un combo est un maximum quel que soit le defi qui le demande, et des
 * contres se cumulent toujours. Porter ce choix sur chaque definition
 * inviterait un jour une declaration fausse : un nouveau defi de combo ecrit
 * `sum` par distraction deviendrait trivial, et rien ne le signalerait.
 */
export const METRIC_ACCUMULATION: Readonly<Record<ChallengeMetric, ChallengeAccumulation>> =
  Object.freeze({
    counters: 'sum',
    perfects: 'sum',
    wins: 'sum',
    rechargePoints: 'sum',
    bestCombo: 'best',
  });

export function accumulationOf(metric: ChallengeMetric): ChallengeAccumulation {
  return METRIC_ACCUMULATION[metric];
}

/**
 * Trois par jour.
 *
 * Assez pour qu'une journee sans envie d'un objectif en laisse deux autres,
 * assez peu pour que la liste se lise d'un coup d'oeil et ne devienne pas une
 * corvee. Le prix : trois defis a environ soixante pieces font cent quatre-
 * vingts par jour, soit une danse d'entree (90) tous les deux jours et une
 * tenue (280) toutes les deux journees pleines. Un rythme, pas une grille.
 */
export const CHALLENGES_PER_DAY = 3;

/**
 * La reserve.
 *
 * Plus large que trois jours de consommation, sinon la selection quotidienne
 * ramenerait les memes objectifs chaque matin — ce qui est pire qu'un defi
 * fixe, parce que ca promet de la variete sans en donner.
 *
 * Les cibles sont posees contre les valeurs du moteur : un match se joue au
 * meilleur des trois manches, donc « deux contres » demande de contrer dans
 * la majorite de ses manches, et « cinq » demande deux bonnes parties.
 */
export const CHALLENGES: readonly ChallengeDefinition[] = Object.freeze([
  {
    id: 'challenge.counter.2',
    name: { fr: 'Contrer deux fois' },
    metric: 'counters',
    target: 2,
    reward: 40,
  },
  {
    id: 'challenge.counter.5',
    name: { fr: 'Contrer cinq fois' },
    metric: 'counters',
    target: 5,
    reward: 80,
  },
  {
    id: 'challenge.perfect.3',
    name: { fr: 'Trois timings parfaits' },
    metric: 'perfects',
    target: 3,
    reward: 50,
  },
  {
    id: 'challenge.perfect.8',
    name: { fr: 'Huit timings parfaits' },
    metric: 'perfects',
    target: 8,
    reward: 90,
  },
  {
    id: 'challenge.win.1',
    name: { fr: 'Gagner un duel' },
    metric: 'wins',
    target: 1,
    reward: 30,
  },
  {
    id: 'challenge.win.3',
    name: { fr: 'Gagner trois duels' },
    metric: 'wins',
    target: 3,
    reward: 70,
  },
  {
    id: 'challenge.recharge.400',
    name: { fr: 'Quatre cents points de recharge' },
    metric: 'rechargePoints',
    target: 400,
    reward: 45,
  },
  {
    id: 'challenge.recharge.900',
    name: { fr: 'Neuf cents points de recharge' },
    metric: 'rechargePoints',
    target: 900,
    reward: 85,
  },
  {
    id: 'challenge.combo.8',
    name: { fr: 'Un combo de huit' },
    metric: 'bestCombo',
    target: 8,
    reward: 50,
  },
  {
    id: 'challenge.combo.14',
    name: { fr: 'Un combo de quatorze' },
    metric: 'bestCombo',
    target: 14,
    reward: 95,
  },
]);

const BY_ID = new Map(CHALLENGES.map((challenge) => [challenge.id, challenge]));

/**
 * Le defi de cet identifiant, ou `undefined`.
 *
 * `undefined` plutot qu'une exception : un identifiant inconnu vient d'un
 * catalogue plus ancien ou plus recent, et faire echouer l'affichage de TOUS
 * les defis a cause d'un seul serait une panne pour une inconnue.
 */
export function challengeById(id: string): ChallengeDefinition | undefined {
  return BY_ID.get(id);
}

const DAY_MS = 86_400_000;

/**
 * Le numero du jour, minuit UTC.
 *
 * Pour tout le monde a la meme seconde. Un decoupage par fuseau obligerait a
 * stocker celui de chaque joueur et a decider ce qui arrive quand il voyage —
 * deux problemes crees pour une journee qui commence de toute facon au moment
 * ou le joueur ouvre le jeu.
 */
export function dayIndexOf(atMs: number): number {
  return Math.floor(atMs / DAY_MS);
}

/**
 * Un melange simple et stable.
 *
 * Pas `Math.random` : la selection doit etre DETERMINISTE, c'est ce qui
 * permet de ne rien stocker de la journee. Le serveur et le client retrouvent
 * les memes trois defis a partir du meme nombre, et un redemarrage ne change
 * pas la journee en cours.
 */
function hash(day: number, salt: number): number {
  let value = (day * 2_654_435_761 + salt * 40_503) >>> 0;
  value ^= value >>> 15;
  value = Math.imul(value, 2_246_822_519) >>> 0;
  value ^= value >>> 13;
  return value >>> 0;
}

/**
 * Les defis du jour.
 *
 * Un par mesure au plus : trois defis qui comptent la meme chose feraient une
 * journee a objectif unique, et un joueur qui n'aime pas cette mesure-la
 * n'aurait rien a faire ce jour-la.
 */
export function challengesForDay(day: number): readonly ChallengeDefinition[] {
  // Un jour negatif — horloge mal reglee — reste une journee valide : rendre
  // un tableau vide donnerait un ecran que personne ne saurait afficher.
  const safe = Number.isFinite(day) ? Math.trunc(day) : 0;

  const ranked = CHALLENGES.map((challenge, index) => ({
    challenge,
    rank: hash(safe, index),
  })).sort((left, right) => left.rank - right.rank);

  const chosen: ChallengeDefinition[] = [];
  const metrics = new Set<ChallengeMetric>();
  for (const { challenge } of ranked) {
    if (chosen.length === CHALLENGES_PER_DAY) break;
    if (metrics.has(challenge.metric)) continue;
    metrics.add(challenge.metric);
    chosen.push(challenge);
  }
  return chosen;
}
