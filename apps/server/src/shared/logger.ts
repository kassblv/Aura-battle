import type { Params } from 'nestjs-pino';
import type { ServerConfig } from './config.js';

/**
 * Journalisation (pino).
 *
 * En developpement, une sortie lisible a l'oeil. En production, du JSON, qui
 * s'indexe. Dans les deux cas on **retire les secrets** : un jeton recopie dans
 * un journal est un jeton compromis, et les journaux d'un serveur de jeu sont
 * lus par plus de monde que sa base de donnees.
 */
export function loggerOptions(config: ServerConfig): Params {
  const development = config.nodeEnv === 'development';
  return {
    pinoHttp: {
      level: development ? 'debug' : 'info',
      // `exactOptionalPropertyTypes` distingue « absent » de « vaut undefined » :
      // en production, la cle ne doit pas exister du tout.
      ...(development
        ? { transport: { target: 'pino-pretty', options: { singleLine: true } } }
        : {}),
      redact: {
        paths: [
          'req.headers.authorization',
          'req.headers.cookie',
          'req.body.token',
          'req.body.refreshToken',
          'req.body.deviceId',
          'res.headers["set-cookie"]',
        ],
        censor: '[masque]',
      },
      // Le corps d'une requete de jeu ne dit rien d'utile en journal, et peut
      // contenir des intentions de match qu'on ne veut pas voir fuiter.
      autoLogging: { ignore: (request) => request.url === '/health' },
    },
  };
}
