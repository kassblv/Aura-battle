/**
 * Ce qu'un service applicatif attend d'un journal.
 *
 * Le strict minimum, et volontairement : les couches application et domaine ne
 * doivent pas dependre de NestJS ni de pino pour pouvoir signaler qu'une
 * dependance exterieure a flanche. `PinoLoggerService` satisfait ce contrat
 * sans rien declarer, et un test peut lui substituer trois lignes.
 */
export interface AppLog {
  warn(message: string): void;
}
