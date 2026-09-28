import { z } from 'zod';
import { matchIdSchema } from './primitives.js';

/**
 * Les evenements produit envoyes par le client (`POST /events`, protocole 2.5.0).
 *
 * Presque tous les indicateurs de `docs/00-vision.md` se deduisent de ce que le
 * serveur enregistre deja. Ne passe par ici que ce que SEUL le client sait :
 * qu'un clip est parti, et avec quoi le joueur a recharge (doigt ou clavier).
 * Une sorte nouvelle se decide ici, jamais a l'envoi — une table de mesure
 * ouverte a toute chaine devient un journal de tout.
 */
export const PRODUCT_EVENT_KINDS = ['clip_shared', 'recharge_input'] as const;

/**
 * Comment le joueur attrape les orbes : au doigt, ou au clavier (sur
 * ordinateur, `apps/mobile/src/platform/inputMode.ts`).
 */
export const RECHARGE_INPUT_MODES = ['touch', 'keys'] as const;
export type RechargeInputMode = (typeof RECHARGE_INPUT_MODES)[number];

export const productEventSchema = z.discriminatedUnion('kind', [
  z.strictObject({
    kind: z.literal('clip_shared'),
    /** Le match du clip : le serveur n'inscrit rien si le joueur n'y siegeait pas. */
    matchId: matchIdSchema,
  }),
  /**
   * Protocole 2.8.0 : le mode de recharge d'un match EN LIGNE, pour comparer
   * clavier et tactile. Le client ne dit que le mode ; les points de recharge
   * sont ceux que le serveur a calcules, jamais une valeur declaree.
   */
  z.strictObject({
    kind: z.literal('recharge_input'),
    matchId: matchIdSchema,
    mode: z.enum(RECHARGE_INPUT_MODES),
  }),
]);

export type ProductEvent = z.infer<typeof productEventSchema>;
export type ProductEventKind = ProductEvent['kind'];
