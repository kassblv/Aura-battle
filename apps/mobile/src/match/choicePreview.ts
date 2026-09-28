import { effectForLevel, type AmplifierLevel, type Move } from '@aura/content';
import { animationFor } from '../content/animations.js';
import { danceFor } from '../app/wardrobe.js';
import type { Presentation } from './presentation.js';

/**
 * L apercu du choix, sur l ecran de celui qui choisit.
 *
 * Pendant la phase de choix, mon personnage prend la pose du mouvement que je
 * selectionne — avec la danse que j ai equipee pour lui — et l aura de
 * l amplificateur que je touche, meme trop cher : voir avant de payer.
 *
 * **Local, et seulement local** (regle d or n°4). Rien de ceci ne part au
 * serveur : il n y a rien a envoyer, c est une reference que l ecran de choix
 * remplit et que la boucle de l arene relit. Le rig de l adversaire n est
 * jamais touche — il reste en garde jusqu a `round:result`, comme avant.
 */

export interface ChoicePreview {
  /** Le mouvement selectionne, ou `null` tant qu aucun style n est choisi. */
  readonly move: Move | null;
  /** L amplificateur touche — joue ou seulement regarde —, ou `null`. */
  readonly amplifier: AmplifierLevel | null;
}

export function withChoicePreview(
  scene: Presentation,
  phase: string,
  preview: ChoicePreview | null,
  /** Effets possedes : un skin achete habille son niveau, ici comme a la revelation. */
  ownedEffects: Iterable<string>,
): Presentation {
  if (phase !== 'choice' || preview === null) return scene;
  if (preview.move === null && preview.amplifier === null) return scene;

  const mine = scene.fighters.a;
  const animationId =
    preview.move === null
      ? mine.animationId
      : animationFor(preview.move, danceFor(mine.look, preview.move)).id;
  const auraEffectId =
    preview.amplifier === null
      ? mine.auraEffectId
      : effectForLevel(preview.amplifier, ownedEffects).id;

  return {
    ...scene,
    fighters: {
      a: {
        ...mine,
        animationId,
        ...(auraEffectId === undefined ? {} : { auraEffectId }),
        ...(preview.amplifier === null ? {} : { auraPreview: true }),
      },
      b: scene.fighters.b,
    },
  };
}
