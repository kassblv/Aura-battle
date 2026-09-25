/**
 * Les delais de la base, choisis ensemble parce qu'ils se tiennent l'un
 * l'autre (leurs relations sont figees dans `database-timeouts.test.ts`).
 *
 * **Sans eux, `pg` attend pour toujours.** `connectionTimeoutMillis` vaut 0 par
 * defaut — attente infinie d'une connexion du bassin — et aucune requete n'a
 * de delai. Une coupure reseau silencieuse vers Postgres (pas de RST, juste
 * plus rien) laissait donc pendre la requete en cours, la transaction qui la
 * portait, et tout ce qui attendait derriere : les achats et les equipements
 * du joueur, mis en file par `KeyedSerializer`.
 *
 * Ordres de grandeur du cas reel, pour situer les nombres : une requete du jeu
 * tient en quelques millisecondes ; la plus lourde — le voisinage d'un joueur
 * dans le classement, qui numerote toute la saison — en quelques dizaines.
 *
 * Ne s'appliquent qu'au serveur (`PrismaService`). Le seed et les migrations
 * construisent leur propre client : l'insertion du vivier de fantomes ou une
 * migration longue ne sont pas bornes par ces valeurs.
 */
export const DATABASE_TIMEOUTS = Object.freeze({
  /**
   * Attente d'une connexion : bassin sature, ou base injoignable. Cinq
   * secondes, comme le `maxWait` de l'enregistrement d'un match : c'est deja
   * la rafale d'une vague de fins de partie. Au-dela, le bassin ne se videra
   * pas a temps, et echouer vite vaut mieux qu'empiler.
   */
  connectMs: 5_000,
  /**
   * Duree d'une instruction, coupee par Postgres lui-meme (`statement_timeout`).
   * Coupee cote serveur, l'instruction rend une erreur propre et la connexion
   * reste saine. Egale au plus long `timeout` de transaction interactive
   * (10 s, l'enregistrement d'un match) et pas moins : sa lecture
   * `FOR KEY SHARE` a le droit d'attendre une suppression de joueur jusque-la,
   * et ce delai ne doit pas la couper plus tot que sa propre transaction.
   * Trois ordres de grandeur au-dessus de la requete la plus lourde.
   */
  statementMs: 10_000,
  /**
   * Attente d'une reponse, coupee par le client (`query_timeout` de `pg`). Ne
   * sert que quand la base ne repond plus du tout : `statement_timeout` aurait
   * parle avant. D'ou deux secondes de marge au-dessus, pour ne jamais
   * abandonner cote client une instruction que Postgres allait refuser proprement.
   */
  queryMs: 12_000,
  /**
   * Transaction ouverte et muette, fermee par Postgres
   * (`idle_in_transaction_session_timeout`) : il rend alors ses verrous. Si
   * c'est le lien qui est coupe, notre `ROLLBACK` n'arrive jamais, et la ligne
   * `Player` debitee resterait verrouillee — les credits de fin de match du
   * joueur attendraient derriere. Le double du plus long `timeout` de
   * transaction interactive (10 s, l'enregistrement d'un match) : une
   * transaction encore dans ses delais n'est jamais coupee.
   */
  idleInTransactionMs: 20_000,
});

/**
 * Bornes de la transaction d'achat (`PrismaInventoryRepository.grant`).
 *
 * Les valeurs par defaut de Prisma, mais ECRITES : le delai de la file
 * d'inventaire se calcule a partir d'elles, et un defaut ne se compare pas.
 */
export const PURCHASE_TRANSACTION = Object.freeze({ maxWait: 2_000, timeout: 5_000 });

/**
 * Bornes du credit de fin de match (`PrismaRatingRepository.credit`) : pieces,
 * experience et jetons d'un niveau franchi, dans une transaction interactive.
 *
 * Meme attente de connexion que l'enregistrement du match qui la precede :
 * sous charge, un credit abandonne des deux secondes ferait perdre au joueur
 * ce que le match vient de lui donner.
 */
export const CREDIT_TRANSACTION = Object.freeze({ maxWait: 5_000, timeout: 5_000 });

/**
 * Une requete hors transaction, au pire, avant de reussir ou d'echouer :
 * attendre une connexion, puis sa reponse.
 */
export const WORST_QUERY_MS = DATABASE_TIMEOUTS.connectMs + DATABASE_TIMEOUTS.queryMs;
