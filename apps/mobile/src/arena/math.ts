/**
 * Les quelques fonctions d assouplissement du prototype.
 *
 * Elles sont pures et sans horloge : le temps arrive toujours en parametre, ce
 * qui rend chaque module d arene testable image par image.
 */

/**
 * Fraction du chemin a parcourir vers une cible pendant `dt`.
 *
 * Interpoler avec un coefficient fixe rend le mouvement dependant du nombre
 * d images par seconde ; cette forme exponentielle donne le meme ressenti a 30
 * comme a 120 i/s.
 */
export function damp(rate: number, dt: number): number {
  return 1 - Math.exp(-rate * dt);
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** Depart franc, arrivee amortie : l ouverture d une onde de choc. */
export function easeOut(t: number): number {
  return 1 - Math.pow(1 - t, 3);
}
