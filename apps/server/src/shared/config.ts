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
   * Connexions Postgres ouvertes par ce noeud.
   *
   * Le defaut du pilote `pg` est **dix**, et c'est un defaut de bibliotheque,
   * pas une decision. Un noeud de match en consomme sur trois chemins a la
   * fois : la lecture du nom et de la ligue a chaque connexion de joueur,
   * l'ecriture du match acheve — une transaction de quatre allers-retours qui
   * tient sa connexion du debut a la fin — et le classement de fin de partie.
   * Les trois arrivent par vagues, parce que les matchs finissent par vagues.
   *
   * Vingt plutot que dix : le relevé de charge montre une ecriture de match a
   * 55 ms de mediane et pres d'une seconde au p99, et un premier passage a
   * mille matchs qui expirait faute de connexion libre (`P2028`). Vingt reste
   * tres en dessous des cent connexions que Postgres accepte par defaut, ce
   * qui laisse la place aux migrations, aux sondes et a un second noeud.
   */
  databasePoolMax: z.coerce.number().int().min(1).max(200).default(20),
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
  /**
   * Mesure du temps de traitement des messages (`AURA_METRICS=1`, jalon M7).
   *
   * Eteinte par defaut, et ce defaut est un choix : l'instrumentation tient une
   * file par connexion et un histogramme par evenement. C'est peu, mais un
   * serveur de production n'a aucune raison de le payer en permanence — le banc
   * de charge, lui, l'allume explicitement.
   *
   * `'1'` et rien d'autre : `z.coerce.boolean()` rendrait `true` pour la chaine
   * `'0'`, ce qui allumerait la mesure a l'endroit meme ou l'on croit l'eteindre.
   */
  metricsEnabled: z
    .string()
    .default('0')
    .transform((raw) => raw === '1'),
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
    databasePoolMax: env.DATABASE_POOL_MAX,
    metricsEnabled: env.AURA_METRICS,
  });

  if (!parsed.success) {
    const details = parsed.error.issues
      .map((issue) => `  - ${issue.path.join('.') || '(racine)'} : ${issue.message}`)
      .join('\n');
    throw new ConfigError(`Configuration invalide :\n${details}`);
  }

  return Object.freeze(parsed.data);
}
