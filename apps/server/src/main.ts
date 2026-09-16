import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { Logger } from 'nestjs-pino';
import { AppModule } from './app.module.js';
import { loadConfig } from './shared/config.js';

/**
 * Point d'entree du serveur.
 *
 * Fastify plutot qu'Express : le serveur passera l'essentiel de son temps sur
 * des WebSockets, mais les quelques routes REST (authentification, contenu)
 * gagnent a etre legeres, et Fastify valide ses reponses par schema.
 */
async function bootstrap(): Promise<void> {
  const config = loadConfig(process.env);

  const app = await NestFactory.create<NestFastifyApplication>(AppModule, new FastifyAdapter(), {
    bufferLogs: true,
  });
  app.useLogger(app.get(Logger));
  app.enableShutdownHooks();

  // 0.0.0.0 : le serveur doit etre joignable depuis un telephone sur le meme
  // reseau, pas seulement depuis la machine de developpement.
  await app.listen({ port: config.port, host: '0.0.0.0' });

  app.get(Logger).log(`serveur pret sur le port ${config.port} — environnement ${config.nodeEnv}`);
}

void bootstrap();
