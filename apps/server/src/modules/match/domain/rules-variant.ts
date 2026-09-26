import { variantForWeek, weekIndexOf } from '@aura/rules';
import type { MatchRecord } from './ports.js';

/**
 * Les regles d'un match qui s'ouvre (evenements de la semaine, M10).
 *
 * La partie rapide seulement : le classe reste la reference — un LP gagne sous
 * d'autres regles ne vaudrait plus celui d'a cote — et une invitation entre
 * amis joue ce que chacun connait. La semaine se lit a l'OUVERTURE, en heure
 * serveur : un match commence un dimanche soir finit avec les regles de son
 * debut.
 */
export function rulesVariantFor(mode: MatchRecord['mode'], atMs: number): string {
  if (mode !== 'CASUAL') return 'normal';
  return variantForWeek(weekIndexOf(atMs));
}
