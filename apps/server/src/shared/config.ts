import { z } from 'zod';

/**
 * Configuration du serveur, validee au demarrage.
 *
 * Toute la configuration passe par ici : aucun `process.env` ailleurs dans le
 * code. Un demarrage avec une variable manquante ou aberrante doit echouer
 * immediatement et bruyamment, jamais silencieusement avec une valeur par defaut
 * douteuse.
 */
const configSchema = z.object({
  nodeEnv: z.enum(['development', 'test', 'production']).default('development'),
  port: z.coerce.number().int().min(1).max(65535).default(3000),
  databaseUrl: z.string().min(1),
  redisUrl: z.string().min(1),
  jwtSecret: z.string().min(16, 'JWT_SECRET doit faire au moins 16 caracteres'),
  jwtAccessTtl: z.coerce.number().int().positive().default(900),
  jwtRefreshTtl: z.coerce.number().int().positive().default(2_592_000),
  /**
   * Origines autorisees a appeler l'API depuis un navigateur.
   *
   * Liste separee par des virgules, vide par defaut. Vide veut dire « aucune
   * origine etrangere » : c'est le bon reglage quand le client est servi par le
   * meme hote que l'API, et c'est le cas en production.
   *
   * En developpement, le client de Vite tourne sur un autre port — et sur une
   * autre adresse quand on ouvre le jeu depuis un telephone du reseau local.
   * Enumerer ces origines a l'avance est impossible : `loadConfig` laisse donc
   * `main.ts` refleter l'origine appelante hors production.
   */
  corsOrigins: z
    .string()
    .default('')
    .transform((raw) =>
      raw
        .split(',')
        .map((origin) => origin.trim())
        .filter((origin) => origin.length > 0),
    ),
});

export type ServerConfig = Readonly<z.infer<typeof configSchema>>;

/** Jeton d'injection de la configuration. */
export const CONFIG = Symbol('CONFIG');

/** Erreur levee quand l'environnement ne decrit pas une configuration valable. */
export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigError';
  }
}

/**
 * Construit la configuration a partir d'un environnement.
 *
 * Fonction pure : elle prend l'environnement en parametre au lieu de lire
 * `process.env`, ce qui la rend testable sans bricoler les globales.
 */
export function loadConfig(env: NodeJS.ProcessEnv): ServerConfig {
  const parsed = configSchema.safeParse({
    nodeEnv: env.NODE_ENV,
    port: env.PORT,
    databaseUrl: env.DATABASE_URL,
    redisUrl: env.REDIS_URL,
    jwtSecret: env.JWT_SECRET,
    jwtAccessTtl: env.JWT_ACCESS_TTL,
    jwtRefreshTtl: env.JWT_REFRESH_TTL,
    corsOrigins: env.CORS_ORIGINS,
  });

  if (!parsed.success) {
    const details = parsed.error.issues
      .map((issue) => `  - ${issue.path.join('.') || '(racine)'} : ${issue.message}`)
      .join('\n');
    throw new ConfigError(`Configuration invalide :\n${details}`);
  }

  return Object.freeze(parsed.data);
}
