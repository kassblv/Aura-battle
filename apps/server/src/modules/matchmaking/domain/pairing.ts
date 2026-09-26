import type { QueueTicket } from './ticket.js';

/**
 * Decision d'appariement (docs/05-matchmaking-ranking.md, § « File d'attente »).
 *
 * Module **pur** : il recoit les tickets et un instant, il rend des paires.
 * Ni horloge, ni Redis, ni socket — ce qui permet de verifier l'elargissement
 * de la fenetre en quelques microsecondes au lieu de quinze secondes, et de
 * rejouer une situation d'appariement a l'identique quand elle a produit une
 * paire absurde.
 */

/**
 * Fenetre de recherche, en points de MMR.
 *
 * Valeurs de docs/05 : « ±50 au depart, +25 par seconde d'attente, plafonnee a
 * ±400 ». Les changer sans changer le document ferait mentir les deux.
 */
export const SEARCH_WINDOW = {
  initialRange: 50,
  wideningPerSecond: 25,
  maxRange: 400,
} as const;

/**
 * Demi-largeur de la fenetre de recherche apres une certaine attente.
 *
 * L'elargissement se fait par **secondes entieres** : le protocole transporte
 * `searchRange` en entier, et un palier visible vaut mieux qu'un nombre qui
 * tremble a chaque tour de worker. Une attente negative — horloges decalees
 * entre deux serveurs — vaut zero, sinon le joueur concerne porterait une
 * fenetre negative et deviendrait inappariable.
 */
export function searchRange(waitedMs: number): number {
  const waitedSeconds = Math.floor(Math.max(0, waitedMs) / 1_000);
  const widened = SEARCH_WINDOW.initialRange + waitedSeconds * SEARCH_WINDOW.wideningPerSecond;
  return Math.min(widened, SEARCH_WINDOW.maxRange);
}

/** Deux tickets a asseoir face a face. `a` est le plus ancien des deux. */
export interface QueuePair {
  readonly a: QueueTicket;
  readonly b: QueueTicket;
}

export interface PairingOutcome {
  readonly pairs: readonly QueuePair[];
  /** Tickets restes en file, du plus ancien au plus recent. */
  readonly waiting: readonly QueueTicket[];
}

/** Ordre d'anciennete, stable : a egalite d'instant, l'identifiant tranche. */
function bySeniority(left: QueueTicket, right: QueueTicket): number {
  return (
    left.enqueuedAtMs - right.enqueuedAtMs ||
    (left.playerId < right.playerId ? -1 : +(left.playerId > right.playerId))
  );
}

/** Les deux fenetres acceptent-elles cet ecart ? */
function acceptEachOther(left: QueueTicket, right: QueueTicket, nowMs: number): boolean {
  if (left.playerId === right.playerId) return false;
  if (left.mode !== right.mode || left.region !== right.region) return false;

  const gap = Math.abs(left.mmr - right.mmr);
  return (
    gap <= searchRange(nowMs - left.enqueuedAtMs) && gap <= searchRange(nowMs - right.enqueuedAtMs)
  );
}

/** Se sont-ils deja rencontres assez recemment pour qu'on prefere eviter ? */
function metRecently(left: QueueTicket, right: QueueTicket): boolean {
  return (
    left.recentOpponents.includes(right.playerId) || right.recentOpponents.includes(left.playerId)
  );
}

/**
 * Forme les paires realisables a cet instant.
 *
 * L'ordre de traitement est celui de l'anciennete : le joueur qui attend depuis
 * le plus longtemps choisit en premier, ce qui borne l'attente maximale au lieu
 * de la laisser a la chance. Parmi ses candidats acceptables, il prend le MMR
 * le plus proche — le but de la fenetre est d'autoriser un ecart, pas de le
 * rechercher — et, a ecart egal, le plus ancien.
 *
 * Une rencontre recente n'est pas interdite, seulement reportee : elle n'est
 * retenue que si le joueur n'a aucun autre candidat. « Eviter quand c'est
 * possible » (docs/05) ne veut pas dire faire attendre indefiniment les deux
 * seuls joueurs connectes.
 */
export function pairTickets(tickets: readonly QueueTicket[], nowMs: number): PairingOutcome {
  const ordered = [...tickets].sort(bySeniority);
  const taken = new Set<number>();
  const pairs: QueuePair[] = [];

  for (let i = 0; i < ordered.length; i += 1) {
    if (taken.has(i)) continue;
    const ticket = ordered[i]!;

    let best: { index: number; gap: number; recent: boolean } | null = null;

    for (let j = i + 1; j < ordered.length; j += 1) {
      if (taken.has(j)) continue;
      const candidate = ordered[j]!;
      if (!acceptEachOther(ticket, candidate, nowMs)) continue;

      const gap = Math.abs(ticket.mmr - candidate.mmr);
      const recent = metRecently(ticket, candidate);

      // Un adversaire neuf passe avant un adversaire recent, quel que soit
      // l'ecart de MMR ; a statut egal, l'ecart tranche, puis l'anciennete
      // (les candidats sont deja parcourus du plus ancien au plus recent).
      const better =
        best === null || (!recent && best.recent) || (recent === best.recent && gap < best.gap);
      if (better) best = { index: j, gap, recent };
    }

    if (best === null) continue;
    taken.add(i);
    taken.add(best.index);
    pairs.push({ a: ticket, b: ordered[best.index]! });
  }

  return {
    pairs,
    waiting: ordered.filter((_, index) => !taken.has(index)),
  };
}
