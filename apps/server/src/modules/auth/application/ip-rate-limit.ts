import { ipBucket } from '../domain/email.js';
import type { AttemptLimiter } from '../domain/ports.js';

/**
 * Limite de debit par adresse IP des routes publiques d'authentification.
 *
 * `/auth/device` cree un compte a chaque secret neuf, `/auth/refresh` et
 * `/auth/recovery/claim` s'appellent sans session : sans borne, un script en
 * fait un generateur de comptes ou un banc d'essai de jetons. Meme compteur
 * et memes seaux d'IP que la connexion par email (IPv6 par /64).
 *
 * Bornes pour un joueur honnete, fenetre de quinze minutes : il relance son
 * jeu et renouvelle sa session sans y penser, jamais soixante fois en un
 * quart d'heure. Un reseau d'operateur qui partage une adresse entre beaucoup
 * d'abonnes est le cas limite ; il est note dans l'ADR 0013.
 */
export const IP_RATE_LIMITS = Object.freeze({
  refresh: 60,
  device: 60,
  claim: 20,
});

export type IpRateScope = keyof typeof IP_RATE_LIMITS;

export class IpRateLimit {
  /**
   * @param enabled `false` seulement hors production (bancs de charge, qui
   *   creent des centaines de comptes depuis 127.0.0.1) : la configuration
   *   refuse de la desactiver en production.
   */
  constructor(
    private readonly limiter: AttemptLimiter,
    private readonly enabled: boolean,
  ) {}

  async allow(
    scope: IpRateScope,
    ip: string | undefined,
  ): Promise<'ALLOWED' | 'LIMITED' | 'NO_ADDRESS'> {
    if (!this.enabled) return 'ALLOWED';
    const bucket = ipBucket(ip);
    if (bucket === null) return 'NO_ADDRESS';
    const allowed = await this.limiter.attempt([
      { key: `http:${scope}:ip:${bucket}`, limit: IP_RATE_LIMITS[scope] },
    ]);
    return allowed ? 'ALLOWED' : 'LIMITED';
  }
}
