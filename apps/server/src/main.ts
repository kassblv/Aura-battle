import { RULES_VERSION } from '@aura/rules';
import { PROTOCOL_VERSION } from '@aura/protocol';
import { loadConfig } from './shared/config.js';

/**
 * Point d'entree du serveur.
 *
 * Le serveur NestJS (modules auth, match, matchmaking...) arrive au jalon M3,
 * voir docs/02-architecture.md. Pour l'instant on valide seulement que la
 * configuration se charge et que les packages partages se resolvent.
 */
function bootstrap(): void {
  const config = loadConfig(process.env);
  console.log(
    `[server] pret — env=${config.nodeEnv} port=${config.port} ` +
      `regles=${RULES_VERSION} protocole=v${PROTOCOL_VERSION}`,
  );
}

bootstrap();
