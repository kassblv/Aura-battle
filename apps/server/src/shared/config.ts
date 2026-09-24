import { z } from 'zod';

/**
 * Configuration du serveur, validee au demarrage.
 *
 * Toute la configuration passe par ici : aucun `process.env` ailleurs dans le
 * code. Un demarrage avec une variable manquante ou aberrante doit echouer
 * immediatement et bruyamment, jamais silencieusement avec une valeur par defaut
 * douteuse.
 */
/** Seule valeur qui allume la mesure de charge. */
const METRICS_ON = '1';

/**
 * La mesure de charge est-elle demandee par cet environnement ?
 *
 * Doublon apparent de `metricsEnabled`, et pourtant necessaire : NestJS decide
 * d'enregistrer ou non l'intercepteur global **au chargement du module**,
 * avant qu'aucun fournisseur n'existe. La regle — `AURA_METRICS=1`, et rien
 * d'autre — reste donc definie ici, a un seul endroit, plutot que recopiee
 * dans un module ou elle finirait par diverger.
 *
 * Cette fonction ne valide rien et ne leve jamais : elle est appelee a
 * l'import, la ou une configuration invalide doit encore pouvoir echouer
 * proprement au demarrage.
 */
export function metricsRequestedIn(env: NodeJS.ProcessEnv): boolean {
  return env.AURA_METRICS === METRICS_ON;
}

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
    .transform((raw) => raw === METRICS_ON),
  /**
   * Secret exige par les routes de mesure quand l'instrumentation tourne.
   *
   * `/health/metrics` dit combien de matchs vivent sur le noeud, a quelle
   * cadence, et combien de memoire il occupe ; `/health/metrics/reset` efface
   * la fenetre en cours. Les deux etaient ouvertes a qui sait former une
   * requete HTTP. La premiere renseigne qui prepare une charge, la seconde
   * aveugle la mesure pendant qu'elle a lieu.
   *
   * Vide par defaut, parce que la mesure est eteinte par defaut : le couple
   * « allumee sans secret » est refuse au demarrage plus bas, plutot que
   * tolere en silence.
   */
  metricsToken: z.string().default(''),
  /**
   * Secret du panneau d'administration.
   *
   * **Vide par defaut, et le panneau reste alors ferme.** Un tableau de bord
   * ouvert a qui sait former une requete dirait combien de joueurs existent,
   * quand la sauvegarde a echoue et depuis quand le serveur tourne — tout ce
   * qu'il faut pour choisir son moment.
   *
   * Il ne vit PAS dans la table des joueurs. Y mettre un drapeau
   * d'administrateur placerait le privilege le plus eleve du systeme dans la
   * meme ligne qu'un compte invite que n'importe quel navigateur peut creer ;
   * un secret hors base ne peut pas etre accorde par une faille applicative.
   *
   * Trente-deux caracteres minimum quand il est pose : un secret court est
   * pire qu'aucun, parce qu'il donne le sentiment d'une porte fermee.
   */
  /**
   * Le commit deploye, tel que l'image le porte.
   *
   * Pose a la construction (`SOURCE_COMMIT`, que Coolify fournit). Sans lui,
   * le panneau dit « inconnu » plutot que d'inventer : savoir QUELLE version
   * tourne est la premiere question qu'on se pose devant un comportement
   * inattendu, et une reponse fausse y repond mal.
   */
  commit: z
    .string()
    .default('inconnu')
    .transform((raw) => (raw.trim() === '' ? 'inconnu' : raw.trim().slice(0, 40))),
  adminToken: z
    .string()
    .default('')
    .refine(
      (value) => value.length === 0 || value.length >= 32,
      'ADMIN_TOKEN doit faire au moins 32 caracteres, ou rester vide',
    ),
  /**
   * Dossier du build du client, servi par ce serveur.
   *
   * Vide par defaut, et c est le bon defaut en developpement : Vite sert le
   * client lui-meme, sur un autre port. En production la variable designe le
   * build, le jeu et son API partagent une seule origine — c est l hypothese
   * sur laquelle `corsOrigins` repose deja — et il n y a qu un conteneur a
   * deployer.
   *
   * Un dossier fait d espaces vaut une absence : sinon une variable laissee a
   * blanc dans un panneau de deploiement ferait echouer le service de
   * fichiers sur un chemin qui n existe pas.
   */
  clientDir: z
    .string()
    .default('')
    .transform((raw) => raw.trim()),
  /**
   * Adresses des mandataires de confiance devant ce serveur.
   *
   * La limite de tentatives de connexion compte **par adresse IP**. Derriere
   * Traefik, l'adresse vue par la socket est celle de Traefik : sans ce
   * reglage, tous les joueurs du monde partageraient un seul compteur, et vingt
   * fautes de frappe fermeraient la connexion par email a tout le monde.
   *
   * Des adresses et non un nombre de sauts : Fastify 5 refuse desormais de
   * croire un nombre de sauts (il ne verifie pas QUI parle), et `true`
   * croirait `X-Forwarded-For` en entier, dont la partie gauche est ecrite par
   * le client — un bot changerait d'adresse a chaque requete. On croit donc
   * les mandataires **par leur adresse** (syntaxe `proxy-addr` : `loopback`,
   * `uniquelocal`, des CIDR separes par des virgules), et seulement eux.
   * Vide (defaut) : pas de mandataire, c'est la socket qui fait foi.
   */
  /**
   * Limite de debit par IP des routes publiques d'authentification (ADR 0013).
   *
   * `'off'` et rien d'autre la coupe, pour les bancs de charge qui creent des
   * centaines de comptes depuis 127.0.0.1. Refusee en production : une limite
   * qu'une variable oubliee eteint n'en est pas une.
   */
  authRateLimit: z
    .string()
    .default('on')
    .transform((raw) => raw.trim() !== 'off'),
  trustProxy: z
    .string()
    .default('')
    .transform((raw) => raw.trim()),
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
    metricsToken: env.AURA_METRICS_TOKEN,
    adminToken: env.ADMIN_TOKEN,
    commit: env.SOURCE_COMMIT,
    clientDir: env.CLIENT_DIR,
    trustProxy: env.TRUST_PROXY,
    authRateLimit: env.AUTH_RATE_LIMIT,
  });

  if (!parsed.success) {
    const details = parsed.error.issues
      .map((issue) => `  - ${issue.path.join('.') || '(racine)'} : ${issue.message}`)
      .join('\n');
    throw new ConfigError(`Configuration invalide :\n${details}`);
  }

  if (parsed.data.metricsEnabled && parsed.data.metricsToken.length === 0) {
    throw new ConfigError(
      "Configuration invalide :\n  - AURA_METRICS_TOKEN : requis des que AURA_METRICS=1, sinon les releves de charge sont lisibles et effacables par n'importe qui",
    );
  }

  if (parsed.data.nodeEnv === 'production' && !parsed.data.authRateLimit) {
    throw new ConfigError(
      "Configuration invalide :\n  - AUTH_RATE_LIMIT : 'off' est refuse en production, la limite de debit des routes d'authentification ne se coupe que pour un banc de charge",
    );
  }

  return Object.freeze(parsed.data);
}
