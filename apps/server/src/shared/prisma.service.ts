import { Injectable, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';
import type { ServerConfig } from './config.js';

/**
 * Client Prisma, branche au cycle de vie de Nest.
 *
 * Depuis Prisma 7, la connexion passe par un **adaptateur de driver** plutot
 * que par une URL inscrite dans le schema : le schema ne contient plus de
 * secret, et c'est la configuration validee au demarrage qui fournit l'URL.
 */
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  constructor(config: ServerConfig) {
    /**
     * La taille du bassin est **choisie**, pas heritee.
     *
     * `pg` ouvre dix connexions par defaut. Ce nombre ne vient d'aucune
     * mesure : il est le meme pour un script d'administration et pour un
     * noeud qui tient cinq cents duels. Le laisser implicite, c'est decider
     * sans le savoir — et decouvrir la decision le jour ou des matchs
     * n'arrivent plus a s'ecrire (`P2028`).
     */
    super({
      adapter: new PrismaPg({
        connectionString: config.databaseUrl,
        max: config.databasePoolMax,
      }),
    });
  }

  async onModuleInit(): Promise<void> {
    await this.$connect();
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}
