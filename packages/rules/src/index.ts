/**
 * @aura/rules — moteur de regles pur et deterministe.
 *
 * Contraintes non negociables (voir CLAUDE.md) :
 * - aucune I/O, aucun `Date.now()`, aucun `Math.random()` ;
 * - le temps et le hasard sont passes en entree (horloge et graine) ;
 * - aucun import de Node, du DOM, de Three.js ou de NestJS.
 *
 * Le contenu reel arrive au jalon M1 (docs/08-roadmap.md).
 */

/** Version du moteur de regles, exposee dans le handshake du protocole. */
export const RULES_VERSION = '0.0.0';

/** Les deux places d'un match. Le siege est stable pour toute la duree du match. */
export type Seat = 'a' | 'b';

/** Renvoie le siege adverse. */
export function opponentOf(seat: Seat): Seat {
  return seat === 'a' ? 'b' : 'a';
}
