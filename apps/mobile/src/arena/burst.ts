import type { Seat } from '@aura/rules';
import type { ClashSpec } from './clash.js';
import type { RingOptions, SparkBurstOptions } from './fx.js';

/**
 * Ce qu une revelation et un contact font naitre.
 *
 * Purement descriptif : ces fonctions ne touchent ni le temps ni la scene,
 * elles disent seulement « une gerbe de tant d etincelles, de ces couleurs, et
 * ces anneaux-la ». `director.ts` les joue, `fx.ts` les dessine.
 *
 * C est ici que se decide la **lecture de l issue sans texte**. Trois manieres
 * de gagner une manche, trois images differentes :
 *
 * - au score : une gerbe blanche et un anneau blanc, sobres ;
 * - par un contre : la gerbe et les anneaux prennent la couleur de celui qui
 *   contre, et il y en a deux — un debout, un au sol ;
 * - par un Ultime : tout passe a l or, plus large et plus rapide. L Ultime vaut
 *   ×1,5 et annule le contre adverse ; c est la plus forte des trois, elle doit
 *   se voir comme telle.
 *
 * Une manche nulle, elle, ne recompense personne : gerbe reduite, anneau etroit,
 * et le point de rencontre qui reste au centre (voir `clashBias`).
 */

/** L or de l Ultime et le rose de son onde, repris du prototype. */
export const ULTIMATE_GOLD = '#ffcf3f';
export const ULTIMATE_PINK = '#ff4fa3';
const WHITE = '#ffffff';

export interface BurstScript {
  readonly sparks: SparkBurstOptions;
  readonly rings: readonly RingOptions[];
}

export interface RevealBurstInput {
  /** Couleur d aura du combattant qui se revele. */
  readonly color: string;
  readonly ultimate: boolean;
}

/**
 * La gerbe d une revelation.
 *
 * Portee telle quelle de `revealSide` : trente-quatre etincelles a 2,6 m/s et
 * un anneau au sol de 1,30 m. L Ultime remplace le tout par sa propre gerbe,
 * plus dense et plus rapide, et ajoute une onde dressee.
 */
export function revealBurst(input: RevealBurstInput): BurstScript {
  if (input.ultimate) {
    return {
      sparks: { count: 80, colors: [ULTIMATE_GOLD, ULTIMATE_PINK, WHITE], speed: 3.8 },
      rings: [
        { color: ULTIMATE_GOLD, radius: 1.9, plane: 'ground' },
        { color: ULTIMATE_PINK, radius: 1.2, plane: 'upright' },
      ],
    };
  }
  return {
    sparks: { count: 34, colors: [input.color, WHITE], speed: 2.6 },
    rings: [{ color: input.color, radius: 1.3, plane: 'ground' }],
  };
}

export type BurstColors = Readonly<Record<Seat, string>>;

/**
 * La gerbe du contact, qui dit comment la manche s est jouee.
 *
 * Le prototype en avait une seule, identique pour toutes les issues : quarante-
 * six etincelles et un anneau blanc. Elle survit telle quelle comme cas
 * ordinaire ; les trois autres s en ecartent exprès.
 */
export function impactBurst(spec: ClashSpec, colors: BurstColors): BurstScript {
  if (spec.ultimate !== null) {
    return {
      sparks: {
        count: 80,
        colors: [ULTIMATE_GOLD, colors[spec.ultimate], WHITE],
        speed: 4.4,
      },
      rings: [
        { color: ULTIMATE_GOLD, radius: 1.5, plane: 'upright' },
        { color: ULTIMATE_GOLD, radius: 2, plane: 'ground' },
      ],
    };
  }

  if (spec.counter !== null) {
    const color = colors[spec.counter];
    return {
      sparks: { count: 60, colors: [color, WHITE], speed: 3.8 },
      rings: [
        { color, radius: 1.25, plane: 'upright' },
        { color, radius: 1.6, plane: 'ground' },
      ],
    };
  }

  if (spec.winner === null) {
    // Personne ne marque : un heurt, pas une explosion.
    return {
      sparks: { count: 26, colors: [colors.a, colors.b, WHITE], speed: 2.4 },
      rings: [{ color: WHITE, radius: 0.7, plane: 'upright', alpha: 0.6 }],
    };
  }

  return {
    sparks: { count: 46, colors: [colors[spec.winner], WHITE], speed: 3.2 },
    rings: [{ color: WHITE, radius: 0.9, plane: 'upright' }],
  };
}

/**
 * Recul du perdant, en metres.
 *
 * Le prototype poussait de 34 unites logiques — 34 centimetres. Un contre ou
 * un Ultime pousse plus loin : la distance parcourue est encore une facon de
 * lire l ecart, et elle se voit de loin.
 */
export function knockbackDistance(spec: ClashSpec): number {
  if (spec.winner === null) return 0;
  if (spec.ultimate === spec.winner) return 0.55;
  if (spec.counter === spec.winner) return 0.45;
  return 0.34;
}
