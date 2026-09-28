import { Injectable, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';
import type { PoolConfig } from 'pg';
import type { ServerConfig } from './config.js';
import { DATABASE_TIMEOUTS } from './database-timeouts.js';

/**
 * La configuration du bassin `pg`, tout entiere choisie.
 *
 * **La taille** : `pg` ouvre dix connexions par defaut. Ce nombre ne vient
 * d'aucune mesure : il est le meme pour un script d'administration et pour un
 * noeud qui tient cinq cents duels. Le laisser implicite, c'est decider sans
 * le savoir — et decouvrir la decision le jour ou des matchs n'arrivent plus a
 * s'ecrire (`P2028`).
 *
 * **Les delais** : par defaut, aucun. Voir `DATABASE_TIMEOUTS` pour chaque
 * valeur et ce qu'elle protege.
 */
export function databasePoolConfig(
  config: Pick<ServerConfig, 'databaseUrl' | 'databasePoolMax'>,
): PoolConfig {
  return {
    connectionString: config.databaseUrl,
    max: config.databasePoolMax,
    connectionTimeoutMillis: DATABASE_TIMEOUTS.connectMs,
    statement_timeout: DATABASE_TIMEOUTS.statementMs,
    query_timeout: DATABASE_TIMEOUTS.queryMs,
    idle_in_transaction_session_timeout: DATABASE_TIMEOUTS.idleInTransactionMs,
  };
}

/**
 * Client Prisma, branche au cycle de vie de Nest.
 *
 * Depuis Prisma 7, la connexion passe par un **adaptateur de driver** plutot
 * que par une URL inscrite dans le schema : le schema ne contient plus de
 * secret, et c'est la configuration validee au demarrage qui fournit l'URL.
 */
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  constructor(config: Pick<ServerConfig, 'databaseUrl' | 'databasePoolMax'>) {
    super({ adapter: new PrismaPg(databasePoolConfig(config)) });
  }

  async onModuleInit(): Promise<void> {
    await this.$connect();
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}
