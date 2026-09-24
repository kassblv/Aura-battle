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
  // Identifiants et preuves des routes d'authentification. Aucun site d'appel
  // ne journalise un corps de requete aujourd'hui ; un `logger.debug(body)`
  // pose pendant un debogage recopierait un mot de passe en clair.
  'password',
  '*.password',
  'currentPassword',
  '*.currentPassword',
  'newPassword',
  '*.newPassword',
  'recoveryCode',
  '*.recoveryCode',
  'email',
  '*.email',
  'secretHash',
  '*.secretHash',
  'deviceSecret',
  '*.deviceSecret',
  // Pas de `code` generique : `*.code` masquerait aussi `err.code` (P2002…),
  // le premier indice d'un incident. Et les jokers de pino ne descendent que
  // d'un niveau : le corps d'une requete journalisee est nomme en entier.
  'req.body.password',
  'req.body.currentPassword',
  'req.body.newPassword',
  'req.body.recoveryCode',
  'req.body.code',
  'req.body.email',
  'req.body.deviceSecret',
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
/**
 * Ce qu'on garde du message d'une erreur, en caracteres.
 *
 * Assez pour diagnostiquer, trop peu pour deverser. Une erreur Prisma recopie
 * les arguments refuses dans son `message` — c'est ainsi qu'une seule erreur
 * produisait onze mille caracteres de journal, arguments compris.
 */
const MAX_ERROR_MESSAGE = 300;

/**
 * Nombre de lignes de pile conservees.
 *
 * La pile sert a savoir OU, pas quoi : huit cadres menent au coupable, et les
 * suivants sont de la tuyauterie. Sa premiere ligne recopie le message, donc
 * elle est bornee comme lui.
 */
const MAX_STACK_LINES = 8;

/** Coupe une chaine, en disant qu'on l'a coupee. */
function clamp(text: string, limit: number): string {
  return text.length <= limit ? text : `${text.slice(0, limit)}… (${String(text.length)} car.)`;
}

/**
 * Reduit une pile a ses premiers cadres, message borne compris.
 *
 * Le journal doit rester diagnosticable sans devenir un canal : c'est le point
 * de passage obligatoire de tout ce qui s'ecrit, et le seul endroit ou une
 * erreur de bibliotheque — Prisma, Redis — ne peut pas contourner la borne en
 * etant passee telle quelle a `logger.error`.
 */
function shortStack(stack: string | undefined): string | undefined {
  if (stack === undefined) return undefined;
  const lines = stack.split('\n');
  const kept = lines.slice(0, MAX_STACK_LINES).map((line) => clamp(line, MAX_ERROR_MESSAGE));
  if (lines.length > MAX_STACK_LINES) {
    kept.push(`    … ${String(lines.length - MAX_STACK_LINES)} cadre(s) de plus`);
  }
  return kept.join('\n');
}

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
      const message = clamp(value.message, MAX_ERROR_MESSAGE);
      return {
        text: message,
        fields: { err: { name: value.name, message, stack: shortStack(value.stack) } },
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
