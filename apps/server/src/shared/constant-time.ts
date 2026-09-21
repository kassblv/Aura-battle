import { createHash, timingSafeEqual } from 'node:crypto';

/**
 * Compare deux secrets sans laisser fuir leur contenu par le temps.
 *
 * Une egalite de chaines sort au premier octet different : le temps de reponse
 * dit alors combien d'octets etaient bons, et le secret se devine octet par
 * octet. On compare donc des empreintes de longueur fixe, ce qui regle du meme
 * coup le cas de deux chaines de longueurs differentes — que `timingSafeEqual`
 * refuse de comparer.
 *
 * Partagee entre la sonde de mesure et l'administration : deux copies de cette
 * fonction seraient deux endroits ou l'une pourrait cesser d'etre a temps
 * constant sans que personne ne le remarque.
 */
export function constantTimeEquals(a: string, b: string): boolean {
  const left = createHash('sha256').update(a).digest();
  const right = createHash('sha256').update(b).digest();
  return timingSafeEqual(left, right);
}
