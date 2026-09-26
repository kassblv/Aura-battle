/**
 * Generateur pseudo-aleatoire seede.
 *
 * Le moteur de regles n'a pas le droit d'appeler `Math.random()` : tout le
 * hasard du jeu (sequence d'orbes, parametres de jauge, style par defaut)
 * descend d'une graine choisie par le serveur. Meme graine, meme partie — ce
 * qui permet de rejouer un match pour arbitrer un litige.
 */

/**
 * Hachage FNV-1a 32 bits : transforme une graine textuelle en entier.
 * Deux graines proches ("round-1", "round-2") donnent des etats tres eloignes.
 */
function hashSeed(seed: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < seed.length; index += 1) {
    hash ^= seed.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/** mulberry32 : petit generateur rapide, periode 2^32, suffisant pour du jeu. */
function mulberry32(state: number): () => number {
  let current = state;
  return () => {
    current = (current + 0x6d2b79f5) | 0;
    let t = Math.imul(current ^ (current >>> 15), 1 | current);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}

export interface Rng {
  /** Reel dans [0, 1[. */
  nextFloat(): number;
  /** Entier dans [min, max], bornes incluses. */
  nextInt(min: number, max: number): number;
  /** Un element de la liste, tiree uniformement. */
  pick<T>(items: readonly T[]): T;
  /** Vrai avec la probabilite demandee. */
  chance(probability: number): boolean;
}

/** Cree un generateur a partir d'une graine textuelle. */
export function createRng(seed: string): Rng {
  const nextFloat = mulberry32(hashSeed(seed));

  const nextInt = (min: number, max: number): number => {
    if (max < min) {
      throw new RangeError(`Intervalle invalide : [${min}, ${max}]`);
    }
    return min + Math.floor(nextFloat() * (max - min + 1));
  };

  return {
    nextFloat,
    nextInt,
    pick<T>(items: readonly T[]): T {
      if (items.length === 0) {
        throw new RangeError('pick() sur une liste vide');
      }
      return items[nextInt(0, items.length - 1)] as T;
    },
    // On consomme toujours un tirage, meme a 0 ou 1 : le flux avance de la meme
    // maniere quelles que soient les probabilites, donc il reste previsible.
    chance: (probability: number): boolean => nextFloat() < probability,
  };
}

/**
 * Derive une graine fille d'une graine de match.
 *
 * Chaque usage a son propre flux : les orbes d'une manche ne doivent pas
 * consommer les tirages de la jauge de timing, sinon changer l'un deplacerait
 * l'autre et un rejeu ne redonnerait pas la meme partie.
 */
export function deriveSeed(seed: string, ...parts: readonly (string | number)[]): string {
  return [seed, ...parts].join('|');
}
