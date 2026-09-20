import { type LoggerService } from '@nestjs/common';
import { pino, type DestinationStream, type Logger } from 'pino';
import type { ServerConfig } from './config.js';

/**
 * Journalisation (pino).
 *
 * Deux exigences, et la seconde compte autant que la premiere.
 *
 * 1. Aucun secret dans les journaux : un jeton recopie dans un journal est un
 *    jeton compromis, et les journaux d'un serveur de jeu sont lus par bien plus
 *    de monde que sa base de donnees.
 * 2. Aucun etat de match confidentiel : le choix, le timing et la recharge d'un
 *    joueur ne doivent pas plus transiter par un journal que par le reseau
 *    (regle d'or n°4). Un `logger.debug({ choice })` place la pendant un
 *    deboguage est exactement le genre de fuite qui survit au deboguage.
 */
const REDACTED_PATHS = [
  // Secrets
  'token',
  '*.token',
  'refreshToken',
  '*.refreshToken',
  'accessToken',
  '*.accessToken',
  'deviceId',
  '*.deviceId',
  // L'empreinte d'appareil, sous ses deux noms : `deviceHash` dans le domaine,
  // `subject` dans la table des identites. Aucun site d'appel ne les journalise
  // aujourd'hui — c'est precisement pour que ca reste vrai apres le prochain
  // debogage qu'elles sont ici.
  'deviceHash',
  '*.deviceHash',
  'subject',
  '*.subject',
  'jwtSecret',
  '*.jwtSecret',
  'req.headers.authorization',
  'req.headers.cookie',
  'res.headers["set-cookie"]',
  // Etat de match confidentiel avant la revelation
  'choice',
  '*.choice',
  'timing',
  '*.timing',
  'taps',
  '*.taps',
];

/**
 * Cree le logger racine.
 *
 * @param destination Flux de sortie. Injectable pour que la redaction soit
 *   verifiable par un test plutot que constatee a l'oeil en production.
 */
export function createLogger(config: ServerConfig, destination?: DestinationStream): Logger {
  const development = config.nodeEnv === 'development';
  const options = {
    level: development ? 'debug' : 'info',
    redact: { paths: REDACTED_PATHS, censor: '[masque]' },
    base: { env: config.nodeEnv },
  } as const;

  if (destination !== undefined) {
    return pino(options, destination);
  }
  return development
    ? pino({ ...options, transport: { target: 'pino-pretty', options: { singleLine: true } } })
    : pino(options);
}

/**
 * Adaptateur entre pino et l'interface de journalisation de Nest.
 *
 * Ecrit a la main plutot que via une integration tierce : le contrat de Nest
 * tient en cinq methodes, et posseder ce point de passage garantit que rien ne
 * contourne la redaction ci-dessus.
 */
export class PinoLoggerService implements LoggerService {
  constructor(private readonly logger: Logger) {}

  /**
   * Met une valeur quelconque sous une forme que pino sait ecrire.
   *
   * Le cas qui compte est l'`Error` : `JSON.stringify(new Error('x'))` rend
   * `{}`, parce que `message` et `stack` ne sont pas enumerables. Un
   * adaptateur naif avale donc toutes les erreurs en silence — et un journal
   * qui pretend avoir trace quelque chose est pire qu'un journal absent.
   */
  private describe(value: unknown): { text: string; fields: Record<string, unknown> } {
    if (typeof value === 'string') {
      return { text: value, fields: {} };
    }
    if (value instanceof Error) {
      return {
        text: value.message,
        fields: { err: { name: value.name, message: value.message, stack: value.stack } },
      };
    }
    return { text: JSON.stringify(value) ?? String(value), fields: {} };
  }

  private write(
    level: 'info' | 'error' | 'warn' | 'debug' | 'trace',
    message: unknown,
    context?: unknown,
  ): void {
    const { text, fields } = this.describe(message);
    this.logger[level]({ ...fields, ...(typeof context === 'string' ? { context } : {}) }, text);
  }

  log(message: unknown, context?: unknown): void {
    this.write('info', message, context);
  }

  error(message: unknown, trace?: unknown, context?: unknown): void {
    const { text, fields } = this.describe(message);
    this.logger.error(
      {
        ...fields,
        ...(typeof context === 'string' ? { context } : {}),
        ...(trace !== undefined && trace !== null ? { trace } : {}),
      },
      text,
    );
  }

  warn(message: unknown, context?: unknown): void {
    this.write('warn', message, context);
  }

  debug(message: unknown, context?: unknown): void {
    this.write('debug', message, context);
  }

  verbose(message: unknown, context?: unknown): void {
    this.write('trace', message, context);
  }
}
