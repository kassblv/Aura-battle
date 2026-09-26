import { productEventSchema, type ProductEvent } from '@aura/protocol';
import type { AuthOptions } from './auth.js';

/**
 * Envoie un evenement produit (`POST /events`, docs/00-vision « Indicateurs »).
 *
 * **Ne rejette jamais.** Une mesure perdue vaut mieux qu'un ecran qui attend
 * ou qui s'excuse : pas de relance, pas d'erreur remontee. L'evenement est
 * valide AVANT l'envoi — une sorte hors protocole ne quitte pas l'appareil.
 */
export async function reportProductEvent(
  baseUrl: string,
  accessToken: string,
  event: ProductEvent,
  options: AuthOptions = {},
): Promise<void> {
  const checked = productEventSchema.safeParse(event);
  if (!checked.success) return;
  const fetcher = options.fetcher ?? globalThis.fetch.bind(globalThis);
  try {
    await fetcher(`${baseUrl.replace(/\/+$/, '')}/events`, {
      method: 'POST',
      headers: { authorization: `Bearer ${accessToken}`, 'content-type': 'application/json' },
      body: JSON.stringify(checked.data),
    });
  } catch {
    // Silence voulu : voir plus haut.
  }
}
