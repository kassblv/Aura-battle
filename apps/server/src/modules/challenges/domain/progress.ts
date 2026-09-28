import { accumulationOf, type ChallengeDefinition, type ChallengeMetric } from '@aura/content';

/**
 * Progression des defis quotidiens : les regles, sans base ni horloge.
 *
 * `docs/01-game-design.md` §11 : les defis sont **valides cote serveur**. Ce
 * fichier est cette validation, et il est pur — on peut donc verifier qu'un
 * combo ne se cumule pas, ou qu'un double appui ne paie pas deux fois, sans
 * monter une base de donnees.
 */

/** Ce qu'une partie a rapporte, mesure par mesure. */
export type MatchContribution = Readonly<Record<ChallengeMetric, number>>;

export function emptyContribution(): MatchContribution {
  return { counters: 0, perfects: 0, wins: 0, rechargePoints: 0, bestCombo: 0 };
}

/**
 * Ce qu'une manche apprend sur un siege, reduit aux faits qui comptent.
 *
 * Volontairement pauvre : ni score, ni energie, ni palier. Prendre le
 * `RoundSeatOutcome` entier ferait dependre les defis de la forme d'un
 * resultat de manche, et le premier champ ajoute la-bas traverserait jusqu'ici
 * sans qu'on l'ait voulu.
 */
export interface RoundFacts {
  /** A contre l'adversaire — pas « a subi le contre ». */
  readonly countered: boolean;
  readonly perfect: boolean;
  readonly rechargePoints: number;
  readonly bestCombo: number;
}

/**
 * Ce qu'une manche rapporte.
 *
 * Jamais `wins` : une manche ne gagne pas un match. Le compter ici paierait
 * trois fois le defi « gagner un duel » pour une seule partie — et le
 * paierait meme a celui qui a perdu deux manches sur trois.
 */
export function roundContribution(facts: RoundFacts): MatchContribution {
  return {
    counters: facts.countered ? 1 : 0,
    perfects: facts.perfect ? 1 : 0,
    wins: 0,
    rechargePoints: Math.max(0, facts.rechargePoints),
    bestCombo: Math.max(0, facts.bestCombo),
  };
}

/**
 * Deux contributions n'en font qu'une.
 *
 * Chaque mesure suit SA regle — `accumulationOf`, la meme que pour la
 * progression du jour. Sans cela, trois manches a cinq de combo vaudraient un
 * combo de quinze, et le defi le plus dur tomberait sans que personne
 * n'atteigne jamais quinze.
 */
export function mergeContributions(
  left: MatchContribution,
  right: MatchContribution,
): MatchContribution {
  const metrics = Object.keys(left) as readonly ChallengeMetric[];
  const merged = { ...left } as Record<ChallengeMetric, number>;
  for (const metric of metrics) {
    merged[metric] =
      accumulationOf(metric) === 'best'
        ? Math.max(left[metric], right[metric])
        : left[metric] + right[metric];
  }
  return merged;
}

/** Ce que la base garde d'un defi, pour un joueur et un jour. */
export interface StoredProgress {
  readonly challengeId: string;
  readonly progress: number;
  readonly claimed: boolean;
}

/**
 * La progression apres cette partie.
 *
 * Deux regles, et la seconde est celle qu'on oublie :
 *
 * - une mesure cumulable s'AJOUTE — deux parties a deux contres font quatre ;
 * - un combo est un MAXIMUM. « Atteindre un combo de 14 » ne s'obtient pas en
 *   cumulant quatre combos de trois, et cumuler rendrait trivial le defi le
 *   plus dur de la liste sans que rien ne le signale.
 *
 * Plafonnee a la cible : sans cela une barre afficherait 1 400 sur 900, ce
 * qu'un joueur lit comme un bogue — et le jour ou une recompense se
 * calculerait sur le depassement, il deviendrait payant de jouer apres avoir
 * fini.
 */
export function advance(
  challenge: ChallengeDefinition,
  progress: number,
  contribution: MatchContribution,
): number {
  // Une contribution negative n'existe pas ; si elle arrive, elle ne doit
  // surtout pas faire RECULER une progression deja acquise.
  const gained = Math.max(0, contribution[challenge.metric]);
  const raw =
    accumulationOf(challenge.metric) === 'best' ? Math.max(progress, gained) : progress + gained;
  return Math.min(challenge.target, Math.max(progress, raw));
}

export type ClaimOutcome =
  | { readonly status: 'granted'; readonly reward: number }
  | { readonly status: 'already-claimed' }
  | { readonly status: 'incomplete' }
  | { readonly status: 'unknown' };

/**
 * Peut-on encaisser ce defi ?
 *
 * L'ordre des refus n'est pas decoratif. « Deja reclame » passe AVANT « pas
 * fini » : un double appui sur un bouton de recompense est la chose la plus
 * courante du monde, et repondre « pas fini » a quelqu'un qui vient
 * d'encaisser lui ferait croire que sa progression a ete perdue.
 *
 * Et un defi absent de la journee est inconnu, meme fini hier : la
 * progression d'hier appartient a hier. Sans cette garde, laisser l'ecran
 * ouvert par-dessus minuit suffirait a encaisser deux fois le meme objectif.
 */
export function claimOutcome(
  today: readonly ChallengeDefinition[],
  stored: readonly StoredProgress[],
  challengeId: string,
): ClaimOutcome {
  const challenge = today.find((candidate) => candidate.id === challengeId);
  if (challenge === undefined) return { status: 'unknown' };

  const entry = stored.find((candidate) => candidate.challengeId === challengeId);
  if (entry?.claimed === true) return { status: 'already-claimed' };
  if (entry === undefined || entry.progress < challenge.target) return { status: 'incomplete' };

  return { status: 'granted', reward: challenge.reward };
}
