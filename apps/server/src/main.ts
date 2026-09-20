import 'reflect-metadata';
import { fileURLToPath } from 'node:url';
import {
  Catch,
  NotFoundException,
  type ArgumentsHost,
  type ExceptionFilter,
} from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
// L import de type seul suffit : il charge l augmentation de module de
// `@fastify/static`, qui ajoute `sendFile` a `FastifyReply`. Sans lui, le
// decorateur existe a l execution mais pas pour le compilateur.
import type {} from '@fastify/static';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { AppModule } from './app.module.js';
import { loadConfig, type ServerConfig } from './shared/config.js';
import { PinoLoggerService } from './shared/logger.js';
import { servesIndex } from './shared/static-client.js';

/**
 * Point d'entree du serveur.
 *
 * Fastify plutot qu'Express : le serveur passera l'essentiel de son temps sur
 * des WebSockets, mais les quelques routes REST (authentification, contenu)
 * gagnent a etre legeres, et Fastify valide ses reponses par schema.
 */
/**
 * Charge le `.env` du depot, s'il existe.
 *
 * Meme piege que le CLI Prisma (voir `prisma.config.ts`) : rien ne lit ce
 * fichier tout seul. Sans cet appel, `pnpm dev` s'arrete sur « configuration
 * invalide » alors que le fichier est la, a deux dossiers de distance — et
 * l'operateur conclut a une erreur de configuration plutot qu'a une erreur de
 * chargement.
 *
 * En production les variables viennent de l'environnement et le fichier
 * n'existe pas : son absence n'est donc pas une erreur.
 */
function loadDotEnv(): void {
  try {
    process.loadEnvFile(fileURLToPath(new URL('../../../.env', import.meta.url)));
  } catch {
    // Ni fichier, ni probleme.
  }
}

/**
 * Repli de l application a page unique.
 *
 * Une 404 de Nest devient `index.html` quand la requete est une navigation.
 * Le repli passe par la couche d'exceptions **et non** par
 * `setNotFoundHandler` : Nest pose le sien pendant `init()`, et Fastify refuse
 * le second avec « Not found handler already set » — au demarrage, donc apres
 * un deploiement reussi.
 *
 * `servesIndex` decide, et se teste sans serveur.
 */
@Catch(NotFoundException)
class ClientFallbackFilter implements ExceptionFilter {
  catch(_exception: NotFoundException, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const request = http.getRequest<FastifyRequest>();
    const reply = http.getResponse<FastifyReply>();

    if (servesIndex(request.method, request.url)) {
      // La page n'est jamais mise en cache : c'est elle qui porte les noms de
      // fichiers du build, et un cache la ferait charger les scripts de la
      // version precedente apres un deploiement.
      void reply.header('cache-control', 'no-cache').sendFile('index.html');
      return;
    }
    void reply.code(404).send({ code: 'NOT_FOUND' });
  }
}

/**
 * Sert le client depuis le meme hote que l API.
 *
 * Deux serveurs signifieraient deux domaines, du CORS a declarer, et l adresse
 * de l API figee dans le build du client — trois problemes crees pour rien
 * quand un seul conteneur suffit.
 */
function serveClient(app: NestFastifyApplication, config: ServerConfig): void {
  if (config.clientDir === '') return;

  app.useStaticAssets({
    root: config.clientDir,
    // `false` : c'est le filtre ci-dessus qui decide du repli, pas le service
    // de fichiers. Deux regles pour la meme question finiraient par diverger.
    wildcard: false,
    index: false,
  });
  app.useGlobalFilters(new ClientFallbackFilter());
}

async function bootstrap(): Promise<void> {
  loadDotEnv();
  const config = loadConfig(process.env);

  const app = await NestFactory.create<NestFastifyApplication>(AppModule, new FastifyAdapter(), {
    bufferLogs: true,
  });

  /**
   * CORS.
   *
   * En production, seules les origines declarees passent — et la liste vide, qui
   * est le defaut, veut dire « aucune » : le client y est servi par le meme hote
   * que l'API, donc rien n'a besoin d'etre autorise.
   *
   * Hors production, on reflete l'origine appelante. Le client de Vite tourne
   * sur un autre port, et sur une autre adresse des qu'on ouvre le jeu depuis un
   * telephone du reseau local : cette adresse change d'un reseau a l'autre et ne
   * peut pas etre enumeree d'avance. Refleter n'est acceptable que parce que
   * l'API n'utilise pas de cookie — l'autorisation voyage dans un en-tete, qu'un
   * site tiers ne peut pas faire envoyer par le navigateur.
   */
  app.enableCors({
    origin: config.nodeEnv === 'production' ? config.corsOrigins : true,
    credentials: false,
    methods: ['GET', 'POST', 'PATCH', 'OPTIONS'],
    allowedHeaders: ['content-type', 'authorization'],
  });
  // Le logger vient du conteneur : un seul objet pour tout le serveur, donc un
  // seul endroit ou la redaction des secrets est definie.
  const logger = app.get(PinoLoggerService);
  app.useLogger(logger);
  app.enableShutdownHooks();

  serveClient(app, config);

  // 0.0.0.0 : le serveur doit etre joignable depuis un telephone sur le meme
  // reseau, pas seulement depuis la machine de developpement.
  await app.listen({ port: config.port, host: '0.0.0.0' });

  logger.log(`serveur pret sur le port ${config.port} — environnement ${config.nodeEnv}`);
  if (config.clientDir !== '') logger.log(`client servi depuis ${config.clientDir}`);
}

void bootstrap();
