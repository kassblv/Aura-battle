import { z } from 'zod';
import { matchIdSchema } from './primitives.js';

/**
 * Les evenements produit envoyes par le client (`POST /events`, protocole 2.5.0).
 *
 * Presque tous les indicateurs de `docs/00-vision.md` se deduisent de ce que le
 * serveur enregistre deja. Ne passe par ici que ce que SEUL le client sait :
 * qu'un clip est parti. Une sorte nouvelle se decide ici, jamais a l'envoi —
 * une table de mesure ouverte a toute chaine devient un journal de tout.
 */
export const PRODUCT_EVENT_KINDS = ['clip_shared'] as const;

export const productEventSchema = z.strictObject({
  kind: z.enum(PRODUCT_EVENT_KINDS),
  /** Le match du clip : le serveur n'inscrit rien si le joueur n'y siegeait pas. */
  matchId: matchIdSchema,
});

export type ProductEvent = z.infer<typeof productEventSchema>;
export type ProductEventKind = ProductEvent['kind'];
