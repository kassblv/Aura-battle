import type { ServerConfig } from './config.js';

/**
 * Ce qu'un demarrage doit dire tout haut, sans pour autant refuser de partir.
 *
 * Un webhook de paiement ferme n'empeche pas de jouer — refuser de demarrer
 * serait pire —, mais en production il perd des ventes en silence : RevenueCat
 * recoit des 404 et abandonne.
 */
export function startupWarnings(
  config: Pick<ServerConfig, 'nodeEnv' | 'revenuecatWebhookAuth'>,
): readonly string[] {
  if (config.nodeEnv !== 'production') return [];
  const warnings: string[] = [];
  if (config.revenuecatWebhookAuth === '') {
    warnings.push(
      'REVENUECAT_WEBHOOK_AUTH absent : le webhook de paiement est ferme, les achats de jetons ne seront pas credites (docs/10, « Achat de jetons »)',
    );
  }
  return warnings;
}

/**
 * Taille maximale d'un corps de requete HTTP. L'API ne recoit que des
 * intentions en JSON, de quelques centaines d'octets ; le mega par defaut de
 * Fastify etait lu en entier AVANT toute verification — y compris sur la route
 * publique du webhook de paiement.
 */
export const HTTP_BODY_LIMIT = 64 * 1024;
