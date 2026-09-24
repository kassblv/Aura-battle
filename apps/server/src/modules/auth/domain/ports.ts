/**
 * Ports du module d'authentification (architecture hexagonale, docs/02).
 *
 * Le domaine ne connait ni Prisma ni l'horloge systeme : il les recoit. C'est ce
 * qui permet de tester l'expiration d'un jeton ou la detection de rejeu sans
 * base de donnees et sans attendre trente jours.
 */

/**
 * L'identite d'appareil visee existe deja.
 *
 * C'est l'adaptateur qui leve ce type, en traduisant la violation d'unicite que
 * lui rend la base : le cas d'usage rattrape une course entre deux appels sans
 * jamais connaitre le moteur de stockage ni ses codes d'erreur.
 */
export class DeviceIdentityConflictError extends Error {
  constructor(cause?: unknown) {
    super('DEVICE_IDENTITY_CONFLICT', { cause });
    this.name = 'DeviceIdentityConflictError';
  }
}

export interface PlayerRecord {
  readonly id: string;
  readonly displayName: string;
}

export interface RefreshTokenRecord {
  readonly id: string;
  readonly playerId: string;
  readonly tokenHash: string;
  readonly createdAt: Date;
  readonly expiresAt: Date;
  /** `Player.credentialsVersion` a l'emission : les jetons d'acces tires de lui la portent. */
  readonly credentialsVersion: number;
  readonly revokedAt: Date | null;
  readonly replacedBy: string | null;
}

export interface PlayerRepository {
  /** Trouve le joueur portant cette identite d'appareil, ou `null`. */
  findByDeviceHash(deviceHash: string): Promise<PlayerRecord | null>;
  /** Trouve un joueur par son identifiant. */
  findById(playerId: string): Promise<PlayerRecord | null>;
  /**
   * Cree un joueur et son identite d'appareil, en une seule transaction.
   * Leve `DeviceIdentityConflictError` si cette identite est deja prise.
   */
  createWithDeviceIdentity(input: {
    readonly deviceHash: string;
    readonly displayName: string;
  }): Promise<PlayerRecord>;
  /**
   * Rattache une identite d'appareil a un joueur qui existe deja.
   *
   * Sert a la recuperation de compte : le navigateur qui vient de presenter un
   * code y rattache son appareil, sinon le rechargement suivant rouvrirait le
   * compte invite local et la recuperation serait perdue. On **ajoute** une
   * ligne, on n'en deplace aucune (docs/04).
   *
   * Leve `DeviceIdentityConflictError` si cette identite appartient deja a
   * quelqu'un.
   */
  linkDeviceIdentity(playerId: string, deviceHash: string): Promise<void>;
  /**
   * Rattache un appareil ET cree un jeton de rafraichissement, dans UNE
   * transaction qui verrouille la ligne du joueur (`FOR UPDATE`) et exige que
   * la version des identifiants soit encore `expectedVersion` — celle lue avec
   * la preuve (code ou mot de passe).
   *
   * Sans cela, une connexion dont la verification passe AVANT un changement de
   * mot de passe rattachait son appareil APRES le nettoyage, et recevait un
   * jeton a la nouvelle version : l'intrus revenait par la fenetre.
   *
   * - `STALE` : la version a change depuis la preuve ; rien n'est ecrit.
   * - `DEVICE_TAKEN` : ce secret appartient deja a quelqu'un.
   * - `JOINED` : l'appareil est rattache (au plus `MAX_DEVICES`, les plus
   *   anciens detaches : `detached` les compte), le jeton cree, et
   *   `credentialsVersion` est celle a signer dans le jeton d'acces.
   */
  joinDevice(input: {
    readonly playerId: string;
    readonly deviceHash: string;
    readonly expectedVersion: number;
    readonly refreshTokenHash: string;
    readonly expiresAt: Date;
  }): Promise<
    | {
        readonly outcome: 'JOINED';
        readonly player: PlayerRecord;
        readonly credentialsVersion: number;
        readonly detached: number;
      }
    | { readonly outcome: 'STALE' }
    | { readonly outcome: 'DEVICE_TAKEN' }
  >;
  /** Change le nom affiche. Rend `null` si le joueur n existe plus. */
  rename(playerId: string, displayName: string): Promise<PlayerRecord | null>;
  touchLastSeen(playerId: string): Promise<void>;
}

/**
 * Le versant « code de recuperation » du depot de joueurs.
 *
 * Port a part plutot qu'ajout a `PlayerRepository` : le service de
 * recuperation n'a besoin de rien d'autre, et un port qui ne promet que ce
 * qu'on lui demande se simule en trois lignes dans un test.
 */
export interface RecoveryIdentityRepository {
  findById(playerId: string): Promise<PlayerRecord | null>;
  /** Trouve le joueur portant ce code de recuperation, ou `null`. */
  findByRecoveryHash(codeHash: string): Promise<PlayerRecord | null>;
  /**
   * Le joueur portant ce code, et l'instant ou le code a ete delivre.
   *
   * L'age compte : un code tout juste delivre peut l'avoir ete par un intrus
   * muni d'une session volee. Seul un code ancien prouve qu'on est le joueur.
   */
  findRecoveryIdentity(codeHash: string): Promise<{
    readonly player: PlayerRecord;
    readonly issuedAt: Date;
    /** Version des identifiants lue avec le code : le rattachement l'exigera encore. */
    readonly credentialsVersion: number;
  } | null>;
  /**
   * Pose le code de recuperation de ce joueur, en **remplacant** le precedent.
   *
   * Le remplacement est ce qui rend un code revocable : en redemander un
   * annule l'ancien.
   */
  setRecoveryIdentity(playerId: string, codeHash: string): Promise<void>;
}

/**
 * L'adresse visee appartient deja a un autre joueur.
 *
 * Meme role que `DeviceIdentityConflictError` : l'adaptateur traduit la
 * violation d'unicite `(provider, subject)`, le cas d'usage n'en connait que le
 * sens.
 */
export class EmailIdentityConflictError extends Error {
  constructor(cause?: unknown) {
    super('EMAIL_IDENTITY_CONFLICT', { cause });
    this.name = 'EmailIdentityConflictError';
  }
}

export interface EmailIdentityRecord {
  readonly playerId: string;
  /** L'adresse normalisee. */
  readonly email: string;
  /** Hache argon2id, au format PHC (`$argon2id$v=19$...`). */
  readonly secretHash: string;
  /** `Player.credentialsVersion`, lue avec le hache : la preuve vaut pour elle seule. */
  readonly credentialsVersion: number;
}

/**
 * Le versant « email et mot de passe » du depot de joueurs.
 *
 * Port a part, comme `RecoveryIdentityRepository` : le service n'a besoin que
 * de ceci, et un port qui ne promet que ce qu'on lui demande se simule en
 * quelques lignes.
 */
export interface EmailIdentityRepository {
  findById(playerId: string): Promise<PlayerRecord | null>;
  /** L'identite portant cette adresse normalisee, ou `null`. */
  findByEmail(email: string): Promise<EmailIdentityRecord | null>;
  /** L'identite email de ce joueur, ou `null` s'il n'en a pas. */
  findEmailOf(playerId: string): Promise<EmailIdentityRecord | null>;
  /**
   * Rattache une adresse et son hache a un joueur, **si** il n'en a pas deja.
   *
   * La verification et l'ecriture sont atomiques cote adaptateur : deux
   * appuis sur « Valider » ne doivent pas laisser deux adresses au meme joueur.
   * Rend `ALREADY_LINKED` si le joueur en a deja une ; leve
   * `EmailIdentityConflictError` si l'adresse appartient a quelqu'un d'autre.
   */
  linkEmailIdentity(
    playerId: string,
    email: string,
    secretHash: string,
  ): Promise<'LINKED' | 'ALREADY_LINKED'>;
  /**
   * Remplace le hache du mot de passe **et detache les appareils** du joueur,
   * sauf `keepDeviceHash` — celui qui fait la demande, s'il est bien a lui.
   *
   * Changer de mot de passe, c'est souvent chasser quelqu'un : un appareil
   * reste rattache tant que sa ligne `DEVICE` existe, et son secret rouvrirait
   * le compte au prochain lancement. Les deux ecritures vont ensemble, dans
   * une transaction. Dans la meme transaction : `credentialsVersion`
   * incrementee (tout jeton anterieur devient inutilisable) et tous les
   * jetons de rafraichissement revoques a `at`. Rend `false` si le joueur n'a pas
   * d'adresse.
   */
  setPasswordHash(
    playerId: string,
    secretHash: string,
    keepDeviceHash: string | null,
    at: Date,
    /**
     * Hache du code de recuperation NEUF. L'ancien est revoque dans la meme
     * transaction : un intrus qui connaissait l'ancien mot de passe a pu se
     * faire delivrer un code, qui lui aurait rouvert le compte apres coup.
     */
    recoveryCodeHash: string,
  ): Promise<boolean>;
  /**
   * Le joueur de cet appareil, ou `null`. Sert de preuve de possession : un
   * compte sans adresse n'a pas d'autre secret que ses appareils.
   */
  findByDeviceHash(deviceHash: string): Promise<PlayerRecord | null>;
}

/**
 * Hachage des mots de passe.
 *
 * Un port, parce qu'un bon hachage de mot de passe est **lent a dessein** :
 * les tests du cas d'usage n'ont pas a payer ses dizaines de millisecondes, et
 * changer d'algorithme un jour ne toucherait que l'adaptateur.
 */
export interface PasswordHasher {
  hash(password: string): Promise<string>;
  /**
   * Vrai si le mot de passe correspond au hache. Un hache illisible rend
   * `false`, jamais une exception : il ne doit pas devenir une 500 qu'on
   * distinguerait d'un refus.
   */
  verify(hash: string, password: string): Promise<boolean>;
}

/**
 * Trop de hachages en cours : le serveur refuse plutot que d'empiler.
 *
 * argon2 coute 19 Mio et des dizaines de millisecondes par appel. Sans
 * plafond, une rafale sur des adresses et des IP differentes — donc sous
 * toutes les limites de tentatives — epuiserait la memoire du conteneur.
 */
export class PasswordHasherBusyError extends Error {
  constructor() {
    super('PASSWORD_HASHER_BUSY');
    this.name = 'PasswordHasherBusyError';
  }
}

/** Un compteur de tentatives et sa limite sur la fenetre. */
export interface AttemptKey {
  readonly key: string;
  readonly limit: number;
}

/**
 * Limite de tentatives sur une fenetre fixe (anti-bourrage d'identifiants).
 *
 * Compter les **tentatives**, pas les echecs : verifier d'abord puis compter
 * apres laisserait passer cent essais lances en meme temps, qui verraient
 * tous le compteur a zero. Chaque appel incremente d'abord, et c'est le
 * resultat de l'increment qui decide.
 */
export interface AttemptLimiter {
  /** Compte une tentative sur chaque cle ; rend `false` si l'une depasse sa limite. */
  attempt(keys: readonly AttemptKey[]): Promise<boolean>;
  /** Valeur courante d'un compteur, sans le toucher (0 s'il n'existe pas). */
  peek(key: string): Promise<number>;
  /** Remet un compteur a zero : son proprietaire a fait la preuve attendue. */
  reset(key: string): Promise<void>;
  /** Rend une tentative : elle a reussi, elle ne doit pas peser sur les autres. */
  refund(key: string): Promise<void>;
}

export interface RefreshTokenRepository {
  findByHash(tokenHash: string): Promise<RefreshTokenRecord | null>;
  /**
   * Cree un jeton, en y inscrivant la version des identifiants lue sous verrou
   * partage de la ligne du joueur : un changement de mot de passe concurrent
   * passe avant (le jeton porte la nouvelle version) ou apres (il le revoque).
   */
  create(input: {
    readonly playerId: string;
    readonly tokenHash: string;
    readonly expiresAt: Date;
  }): Promise<RefreshTokenRecord>;
  /**
   * Consomme un jeton et cree son remplacant, **atomiquement**.
   *
   * - `REUSED` : le jeton n'etait plus vivant au moment de le consommer (un
   *   autre appel l'a consomme, ou il a ete revoque entre la lecture et
   *   l'ecriture). La consommation est conditionnelle, donc deux appels
   *   concurrents ne peuvent pas la reussir tous les deux.
   * - `STALE` : la version des identifiants du joueur n'est plus celle du
   *   jeton — le mot de passe a change depuis son emission. Lue sous verrou de
   *   la ligne du joueur, comme dans `create`.
   * - `ROTATED` : le remplacant existe, et porte `credentialsVersion`.
   */
  rotate(input: {
    readonly id: string;
    readonly playerId: string;
    readonly credentialsVersion: number;
    readonly replacedByHash: string;
    readonly expiresAt: Date;
    readonly at: Date;
  }): Promise<
    | { readonly outcome: 'ROTATED'; readonly credentialsVersion: number }
    | { readonly outcome: 'REUSED' }
    | { readonly outcome: 'STALE' }
  >;
  /** Revoque tous les jetons vivants d'un joueur. */
  revokeAllForPlayer(playerId: string, at: Date): Promise<void>;
}

/** Signature et verification des jetons d'acces. */
export interface AccessTokenSigner {
  /** `credentialsVersion` devient le claim `cv`, que le verificateur compare a la base. */
  sign(payload: {
    readonly playerId: string;
    readonly credentialsVersion: number;
  }): Promise<string>;
}

/** L'horloge est un port : le temps est une entree, pas une globale. */
export interface Clock {
  now(): Date;
}

/**
 * La version des identifiants d'un joueur, ou `null` s'il n'existe plus.
 *
 * Un jeton d'acces d'une autre version est refuse partout ou on le verifie :
 * c'est ce qui empeche l'intrus chasse de se reinstaller avec le jeton qu'il
 * detenait.
 */
export interface CredentialsVersionReader {
  credentialsVersion(playerId: string): Promise<number | null>;
}
