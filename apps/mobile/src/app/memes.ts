import {
  animationsFor,
  animationId,
  animationPrice,
  STYLES,
  TIERS,
  type Rarity,
  type Style,
  type Tier,
} from '@aura/content';
import { ANIMATIONS } from '../content/animations.js';

/**
 * Le catalogue de memes, tel que l accueil le parcourt.
 *
 * Une aura battle est un clash ou deux personnes rejouent des memes : le
 * catalogue de memes est donc le catalogue de MOUVEMENTS, pas une liste a
 * cote. Il se derive de `@aura/content` pour cette raison — une seconde liste
 * finirait par contenir une danse que le moteur ne connait pas, ou l inverse.
 *
 * L ordre raconte la montee en puissance : par style, puis par palier
 * croissant. C est celui dans lequel le joueur progresse, pas celui des
 * fichiers sur le disque.
 */

export interface MemeCard {
  readonly animationId: string;
  readonly name: string;
  readonly style: Style;
  readonly tier: Tier;
  readonly rarity: Rarity;
  /**
   * Prix en monnaie douce, deduit de la rarete.
   *
   * Jamais ecrit dans le fichier d'animation : la rarete y est deja, et un
   * prix a cote d'elle serait une seconde valeur a tenir d'accord avec la
   * premiere. Le bareme vit dans `@aura/content`.
   */
  readonly price: number;
  /**
   * Offert a tous.
   *
   * La premiere animation de chaque couple style-palier l est (docs/01 §2) ;
   * les autres sont des cosmetiques. La galerie doit le dire, sinon le joueur
   * croit posseder ce qu il ne possede pas.
   */
  readonly free: boolean;
}

export function memeGallery(): readonly MemeCard[] {
  const cards: MemeCard[] = [];
  for (const style of STYLES) {
    for (const tier of TIERS) {
      const move = { style, tier };
      animationsFor(move).forEach((slug, index) => {
        const id = animationId(move, slug);
        const animation = ANIMATIONS.get(id);
        if (animation === undefined) return;
        // La premiere animation de chaque couple style-palier est offerte
        // (docs/01 §2) : sa rarete declaree ne peut donc pas la faire payer.
        const free = index === 0;
        const rarity = (free ? 'default' : (animation.rarity ?? 'default')) as Rarity;
        cards.push({
          animationId: id,
          name: animation.name.fr,
          style,
          tier,
          rarity,
          // La meme regle que le serveur (`animationPrice`) : deux regles avaient
          // diverge, et le serveur donnait ce que la boutique affichait a vendre.
          price: animationPrice(id, rarity),
          free,
        });
      });
    }
  }
  return cards;
}

/**
 * Le meme suivant ou precedent, en bouclant.
 *
 * En paysage et sans defilement, le joueur parcourt au pouce : buter sur une
 * extremite l obligerait a traverser toute la galerie pour atteindre le meme
 * d a cote.
 */
export function stepMeme(gallery: readonly MemeCard[], currentId: string, delta: number): string {
  if (gallery.length === 0) return currentId;
  const index = gallery.findIndex((card) => card.animationId === currentId);
  // Un identifiant inconnu ne doit pas bloquer la navigation : on repart du
  // debut plutot que de rester coince sur un meme qui n existe plus.
  if (index === -1) return gallery[0]!.animationId;
  const next = (index + delta + gallery.length) % gallery.length;
  return gallery[next]!.animationId;
}
