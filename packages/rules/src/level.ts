import { BALANCE } from './balance.js';

/**
 * Le niveau de joueur (docs/01 §11).
 *
 * Le seul compteur qui monte meme quand on perd : une defaite vaut douze
 * d'experience, une victoire trente. C'est le contrepoids des LP, qui
 * descendent — sans lui, une soiree de defaites ne laisse rien derriere elle.
 *
 * Pur et partage : le serveur credite l'experience, le client dessine la
 * barre, et les deux lisent la meme courbe. Deux courbes separees
 * afficheraient un niveau que le serveur ne reconnait pas.
 */

export interface LevelState {
  readonly level: number;
  /** Experience acquise DANS le niveau courant. */
  readonly into: number;
  /** Experience qu'il faut pour finir le niveau courant. */
  readonly needed: number;
  /** Experience totale, telle qu'elle est stockee. */
  readonly total: number;
}

/**
 * Experience cumulee pour ATTEINDRE ce niveau.
 *
 * Geometrique : chaque palier coute `growth` fois le precedent. Une
 * progression lineaire ferait tomber les derniers niveaux aussi vite que les
 * premiers, et le compteur cesserait de vouloir dire quelque chose.
 */
export function xpForLevel(level: number): number {
  const { base, growth } = BALANCE.progression;
  if (level <= 1) return 0;

  let total = 0;
  let step = base;
  for (let current = 2; current <= level; current += 1) {
    total += Math.round(step);
    step *= growth;
  }
  return total;
}

/** Le niveau atteint avec cette experience, et la barre en cours. */
export function levelFor(xp: number): LevelState {
  const { maxLevel } = BALANCE.progression;

  // Une experience negative ou absurde ne fait pas disparaitre le joueur : il
  // est au niveau un, barre vide, comme quelqu'un qui commence.
  const total = Number.isFinite(xp) && xp > 0 ? Math.floor(xp) : 0;

  let level = 1;
  while (level < maxLevel && total >= xpForLevel(level + 1)) level += 1;

  const floor = xpForLevel(level);

  /*
    Au plafond, la barre est PLEINE et le surplus ne se perd pas : il reste
    dans `total`. Une barre a moitie vide apres le dernier niveau ferait croire
    a un niveau suivant qui n'existe pas.
  */
  if (level >= maxLevel) {
    const needed = Math.max(1, xpForLevel(maxLevel) - xpForLevel(maxLevel - 1));
    return { level, into: needed, needed, total };
  }

  return { level, into: total - floor, needed: xpForLevel(level + 1) - floor, total };
}
