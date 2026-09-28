import type { ExperimentGroup, MatchRecord } from './ports.js';

/**
 * Qui voit la bulle d'intention (spec 2026-09-26, § « Exposition au test »).
 *
 * **Partie rapide et invitation seulement** : le classe reste la reference —
 * un LP gagne avec un bonus d'Ultime que la moitie des joueurs n'a pas ne
 * vaudrait plus celui d'a cote.
 */
export function intentBubbleEligible(mode: MatchRecord['mode']): boolean {
  return mode === 'CASUAL' || mode === 'INVITE';
}

/**
 * La bulle est-elle active dans ce match ?
 *
 * `realSeatGroups` : le groupe de chaque siege tenu par une PERSONNE — un
 * fantome ne compte pas (il n'annonce jamais). **Tous** exposes, sinon non :
 * un joueur temoin ne voit ainsi jamais la bulle, au prix d'une exposition
 * partielle du groupe traite.
 */
export function intentBubbleFor(
  mode: MatchRecord['mode'],
  realSeatGroups: readonly ExperimentGroup[],
): boolean {
  if (!intentBubbleEligible(mode)) return false;
  return realSeatGroups.length > 0 && realSeatGroups.every((group) => group === 'treatment');
}
