import { z } from 'zod';
import { errorCodeSchema } from './errors.js';
import { lenient } from './lenient.js';
import {
  cosmeticSchema,
  matchIdSchema,
  opponentCosmeticsSchema,
  moveSchema,
  roundSchema,
  seatSchema,
  serverTimeSchema,
  styleSchema,
  timingQualitySchema,
  parseFailure,
  unknownMessage,
  type ParseResult,
} from './primitives.js';

/** Un identifiant de variante de regles (`RULE_VARIANTS`, @aura/rules). */
const rulesVariantSchema = z.string().regex(/^[a-z][a-z0-9-]{0,23}$/);

/**
 * Messages serveur -> client (docs/03-pvp-protocol.md).
 *
 * Tous les schemas sont **stricts**, et la validation s'applique aussi en
 * sortie : glisser un champ appartenant a l'adversaire dans un message emis
 * avant `round:result` ne produit pas une fuite, mais un refus d'emettre.
 *
 * **Ce que cela ne protege pas.** Un schema ferme les champs *en trop*, pas les
 * mauvaises *valeurs* dans un champ legitime : envoyer a `a` un `choice:start`
 * dont `energy` est celle de `b` reste valide. Le protocole couvre donc la
 * moitie structurelle de la regle d'or n°4 ; l'autre moitie revient au serveur,
 * qui doit construire chaque envoi par une unique fonction de vue par siege
 * (jalon M3), testee en propriete : deux vues d'un meme etat ne partagent
 * aucune valeur propre a l'adversaire.
 */

const normalizedSchema = z.number().min(0).max(1);

/**
 * Nombre maximal d'orbes dans la sequence d'une manche.
 * Borner le tableau rend une anomalie detectable a l'emission, et non sur le
 * telephone du joueur.
 */
const MAX_ORBS_PER_ROUND = 256;

const orbSpecSchema = z.strictObject({
  index: z.number().int().nonnegative(),
  x: normalizedSchema,
  y: normalizedSchema,
  kind: z.enum(['normal', 'golden']),
  points: z.number().int().positive(),
  lifetimeMs: z.number().int().positive(),
});

const roundsWonSchema = z.strictObject({
  a: z.number().int().nonnegative(),
  b: z.number().int().nonnegative(),
});

/** Detail d'un siege apres revelation. C'est le seul endroit ou les deux apparaissent. */
const roundSideSchema = z.strictObject({
  move: moveSchema,
  amp: z.number().int().min(0).max(4),
  ult: z.boolean(),
  cosmetic: cosmeticSchema,
  recharge: z.strictObject({
    points: z.number().int().nonnegative(),
    bestCombo: z.number().int().nonnegative(),
    boostPct: z.number().min(0),
    ultGain: z.number().min(0),
    energyGain: z.number().int().min(0),
  }),
  timing: z.strictObject({
    quality: timingQualitySchema,
    /** Ecart au centre de la jauge, dans [0, 1]. Sert au departage. */
    error: normalizedSchema,
  }),
  repeat: z.boolean(),
  counter: z.boolean(),
  countered: z.boolean(),
  counterBlocked: z.boolean(),
  /**
   * Le siege a joue sa case brillante (×1,2). Facultatif : un serveur 2.0 ne
   * l'envoie pas, et son absence vaut « non » (2.1.0, ajout compatible).
   */
  shiny: z.boolean().optional(),
  base: z.number(),
  final: z.number(),
  energyAfter: z.number().int().min(0),
  ultAfter: z.number().min(0),
});

/**
 * Ce qu'on dit de l'adversaire, et rien de plus.
 *
 * Une liste fermee, partagee par `match:found` et `match:state` : deux
 * definitions separees finiraient par diverger, et c'est du cote de la reprise
 * qu'on aurait ajoute le champ de trop sans que l'autre le refuse.
 */
const opponentSchema = z.strictObject({
  displayName: z.string().min(1).max(40),
  league: z.string().min(1).max(32),
  cosmetics: opponentCosmeticsSchema,
});

export const SERVER_MESSAGES = {
  pong: z.strictObject({ t: z.number(), serverTime: serverTimeSchema }),

  'queue:status': z.strictObject({
    mode: z.enum(['ranked', 'casual']),
    elapsedMs: z.number().int().nonnegative(),
    searchRange: z.number().int().nonnegative(),
  }),

  'invite:created': z.strictObject({
    code: z.string().regex(/^[A-Z0-9]{4,16}$/),
    // Schema impose : le client ouvre ce lien. Un `javascript:` ou un `http:`
    // hostile n'a rien a faire dans un message de notre propre serveur.
    deepLink: z
      .string()
      .regex(/^(aurabattle:\/\/|https:\/\/)[A-Za-z0-9._~:/?#@!$&'()*+,;=%-]{1,200}$/),
    expiresAt: serverTimeSchema,
  }),

  'match:found': z.strictObject({
    matchId: matchIdSchema,
    seat: seatSchema,
    opponent: opponentSchema,
    protocolVersion: z.string().max(16),
    // La version SEULE (`1.0.0`) : la variante voyage a part, dans
    // `rulesVariant`. La forme `1.0.0+ultime` n'existe qu'en base, pour le rejeu.
    rulesVersion: z.string().max(16),
    contentVersion: z.string().max(16),
    ghost: z.boolean(),
    /**
     * La variante de regles de la semaine (2.4.0, partie rapide seulement) :
     * le client affiche SES couts et ses multiplicateurs. Absente : les regles
     * normales. Un identifiant, jamais des valeurs — le client les relit dans
     * `@aura/rules`, comme le serveur.
     */
    rulesVariant: rulesVariantSchema.optional(),
  }),

  // `energy` et `ult` sont ceux du destinataire, jamais de l'adversaire.
  'round:intro': z.strictObject({
    matchId: matchIdSchema,
    round: roundSchema,
    endsAt: serverTimeSchema,
    roundsWon: roundsWonSchema,
    energy: z.number().int().min(0),
    ult: z.number().min(0),
  }),

  'recharge:start': z.strictObject({
    matchId: matchIdSchema,
    round: roundSchema,
    startsAt: serverTimeSchema,
    endsAt: serverTimeSchema,
    orbs: z.array(orbSpecSchema).max(MAX_ORBS_PER_ROUND),
  }),

  'choice:start': z.strictObject({
    matchId: matchIdSchema,
    round: roundSchema,
    endsAt: serverTimeSchema,
    meter: z.strictObject({
      period: z.number().positive(),
      zone: normalizedSchema,
      perfect: normalizedSchema,
      center: normalizedSchema,
    }),
    energy: z.number().int().min(0),
    ult: z.number().min(0),
    /**
     * La case brillante du DESTINATAIRE, et d'aucun autre (regle d'or n°4) :
     * l'adversaire ne la decouvre qu'a `round:result`. Facultative pour rester
     * compatible avec un serveur 2.0.
     */
    shiny: moveSchema.optional(),
  }),

  // Le seul fait public pendant la phase de choix : l'adversaire a verrouille.
  // Ni son mouvement, ni son timing, ni son cout.
  'opponent:locked': z.strictObject({
    matchId: matchIdSchema,
    round: roundSchema,
  }),

  'intent:shown': z.strictObject({
    matchId: matchIdSchema,
    round: roundSchema,
    seat: seatSchema,
    style: styleSchema,
  }),

  'round:result': z.strictObject({
    matchId: matchIdSchema,
    round: roundSchema,
    sides: z.strictObject({ a: roundSideSchema, b: roundSideSchema }),
    winner: seatSchema.nullable(),
    roundsWon: roundsWonSchema,
    timeline: z.strictObject({ revealFirst: seatSchema }),
  }),

  'match:end': z.strictObject({
    matchId: matchIdSchema,
    winner: seatSchema.nullable(),
    reason: z.enum(['rounds', 'tiebreak', 'forfeit', 'disconnect']),
    rating: z.strictObject({
      before: z.number(),
      after: z.number(),
      leagueBefore: z.string(),
      leagueAfter: z.string(),
    }),
    rewards: z.strictObject({
      softCurrency: z.number().int().min(0),
      xp: z.number().int().min(0),
      /**
       * Experience TOTALE apres ce match.
       *
       * Le gain seul ne suffit pas : le niveau se deduit du cumul, et sans lui
       * le client ne peut ni dessiner la barre ni savoir qu'un palier vient
       * d'etre franchi. Avec le total il calcule les deux, en relisant la meme
       * courbe que le serveur (`levelFor`, @aura/rules) — deux courbes
       * separees afficheraient un niveau que le serveur ne reconnait pas.
       */
      xpTotal: z.number().int().min(0),
    }),
  }),

  /**
   * Instantane de reprise apres reconnexion.
   *
   * Il ne contient que ce que le destinataire avait deja le droit de voir :
   * son energie, sa jauge, le fait que l'adversaire ait verrouille ou non, et
   * les manches deja revelees.
   */
  'match:state': z.strictObject({
    /** La variante de regles de ce match (2.4.1) : elle survit a une reprise. */
    rulesVariant: rulesVariantSchema.optional(),
    matchId: matchIdSchema,
    seat: seatSchema,
    phase: z.enum(['intro', 'recharge', 'choice', 'reveal', 'ended']),
    round: roundSchema,
    endsAt: serverTimeSchema,
    roundsWon: roundsWonSchema,
    energy: z.number().int().min(0),
    ult: z.number().min(0),
    opponentLocked: z.boolean(),
    /**
     * Rappel du fait que l'adversaire est un rejeu (docs/05 § « Fantomes »).
     *
     * Il n'etait annonce que dans `match:found`. Une application mobile tuee en
     * arriere-plan — le cas le plus frequent — revenait par `match:rejoin` et
     * finissait la partie **en croyant affronter quelqu'un**. Le drapeau doit
     * survivre a la reprise, sinon la promesse d'honnetete ne tient que tant
     * que le client ne redemarre pas.
     *
     * **Defaut a `false`, et pas optionnel** : le serveur le renseigne
     * toujours — le type de sortie l'exige — mais un instantane venu d'un
     * serveur anterieur aux fantomes n'en portait pas, et cette absence-la ne
     * veut dire qu'une chose : il n'y avait pas de fantome a annoncer. Le
     * client lit donc toujours un booleen, jamais `undefined`.
     */
    ghost: z.boolean().default(false),
    /**
     * Rappel du nom de l'adversaire.
     *
     * Il n'etait annonce que dans `match:found`, donc une application tuee en
     * arriere-plan revenait par `match:rejoin` et finissait la partie contre
     * « Adversaire ». Ce n'est pas une fuite : le destinataire l'avait deja
     * recu a l'ouverture, et c'est exactement ce que cet instantane promet —
     * rien de plus que ce qu'il avait le droit de voir.
     *
     * Optionnel : un annuaire injoignable ne doit pas empecher une reprise.
     */
    opponent: opponentSchema.optional(),
    /**
     * La case brillante du DESTINATAIRE, en phase de choix (2.1.x). Sans elle,
     * une reprise en plein choix la faisait disparaitre pour ce seul joueur,
     * alors que l'adversaire voyait toujours la sienne.
     */
    shiny: moveSchema.optional(),
    orbs: z.array(orbSpecSchema).max(MAX_ORBS_PER_ROUND).optional(),
    meter: z
      .strictObject({
        period: z.number().positive(),
        zone: normalizedSchema,
        perfect: normalizedSchema,
        center: normalizedSchema,
      })
      .optional(),
    history: z.array(
      z.strictObject({
        round: roundSchema,
        winner: seatSchema.nullable(),
        scores: z.strictObject({ a: z.number(), b: z.number() }),
      }),
    ),
  }),

  /**
   * Erreur renvoyee au client.
   *
   * `message` est borne et doit rester une cle i18n ou un texte fixe : c'est le
   * message le plus susceptible de vehiculer de l'etat interne par inadvertance,
   * puisqu'il est tentant d'y recopier le detail d'un echec de validation.
   */
  error: z.strictObject({
    code: errorCodeSchema,
    message: z.string().max(200),
    retryable: z.boolean(),
  }),
} as const;

export type ServerMessageName = keyof typeof SERVER_MESSAGES;

export type ServerMessage<N extends ServerMessageName> = z.infer<(typeof SERVER_MESSAGES)[N]>;

export const SERVER_MESSAGE_NAMES = Object.keys(SERVER_MESSAGES) as readonly ServerMessageName[];

/** Vrai si ce nom d'evenement existe au registre. */
export function isServerMessageName(name: string): name is ServerMessageName {
  return Object.hasOwn(SERVER_MESSAGES, name);
}

/** Un message serveur analyse, nom compris. Union discriminee par `name`. */
export type ParsedServerMessage = {
  [N in ServerMessageName]: { readonly name: N; readonly data: ServerMessage<N> };
}[ServerMessageName];

/**
 * Les schemas d'analyse COTE CLIENT : tolerants aux champs ajoutes par un
 * serveur plus recent (voir `lenient`). Calcules une fois, au chargement.
 */
const CLIENT_PARSERS = Object.fromEntries(
  Object.entries(SERVER_MESSAGES).map(([name, schema]) => [name, lenient(schema)]),
) as Record<ServerMessageName, z.ZodType>;

/**
 * Analyse une charge utile serveur. Utilise par le client, qui recoit des noms
 * du reseau. Les cles inconnues sont ignorees ; le serveur, lui, emet par
 * `serializeServerMessage`, qui reste strict.
 */
export function parseServerMessage(
  name: string,
  payload: unknown,
): ParseResult<ParsedServerMessage> {
  if (!isServerMessageName(name)) {
    return unknownMessage(name);
  }
  const parsed = CLIENT_PARSERS[name].safeParse(payload);
  return parsed.success
    ? { success: true, data: { name, data: parsed.data } as ParsedServerMessage }
    : parseFailure(parsed.error);
}

/**
 * Valide un message **avant de l'emettre**.
 *
 * C'est la moitie du garde-fou qu'on oublie toujours : valider l'entrant
 * protege le serveur, valider le sortant protege les joueurs.
 */
export function serializeServerMessage<N extends ServerMessageName>(
  name: N,
  payload: ServerMessage<N>,
): ParseResult<ServerMessage<N>> {
  const parsed = SERVER_MESSAGES[name].safeParse(payload);
  return parsed.success
    ? { success: true, data: parsed.data as ServerMessage<N> }
    : parseFailure(parsed.error);
}
