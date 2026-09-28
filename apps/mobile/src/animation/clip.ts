/**
 * L horloge propre a une animation : elle part de zero quand l animation change.
 *
 * Les combattants lisaient tous une meme horloge continue. Une danse revelee
 * demarrait donc n importe ou dans sa boucle — au milieu d un saut, a la fin
 * d un geste —, et une danse de quatre images cles pouvait passer ses 1,3 s a
 * l ecran sans jamais montrer son geste principal. Une revelation se lit comme
 * un debut : le mouvement doit partir de sa premiere image.
 *
 * Pure : l etat precedent et l horloge entrent, l etat suivant sort.
 */

export interface ClipClock {
  /** Animation en cours, ou `null` avant la premiere image. */
  readonly id: string | null;
  /** Instant de l horloge des danses ou elle a commence, en secondes. */
  readonly startedAt: number;
}

export const NO_CLIP: ClipClock = Object.freeze({ id: null, startedAt: 0 });

/** Repart de zero si l animation a change, sinon rien ne bouge. */
export function followClip(previous: ClipClock, id: string, clock: number): ClipClock {
  return previous.id === id ? previous : { id, startedAt: clock };
}

/**
 * Temps a echantillonner, en secondes.
 *
 * `idleOffset` ne s applique qu a la garde et aux poses du systeme : deux
 * combattants qui l attendent ensemble ne doivent pas respirer a l unisson.
 * Une danse, elle, part de son debut — chacun la sienne, a l instant de sa
 * revelation, ce qui suffit a les decaler.
 */
export function clipTime(
  clip: ClipClock,
  clock: number,
  looping: boolean,
  idleOffset: number,
): number {
  return clock - clip.startedAt + (looping ? idleOffset : 0);
}
