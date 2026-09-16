import { z } from 'zod';
import { errorCodeSchema } from './errors.js';
import {
  cosmeticSchema,
  matchIdSchema,
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

/**
 * Messages serveur -> client (docs/03-pvp-protocol.md).
 *
 * Tous les schemas sont **stricts**, et la validation s'applique aussi en
 * sortie. C'est ce qui fait tenir la regle d'or n°4 : glisser le choix, le
 * timing, l'energie ou la jauge de l'adversaire dans un message emis avant
 * `round:result` ne produit pas une fuite, mais un refus d'emettre. La
 * confidentialite devient une propriete du protocole, pas une consigne de
 * relecture.
 */

const normalizedSchema = z.number().min(0).max(1);

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
  base: z.number(),
  final: z.number(),
  energyAfter: z.number().int().min(0),
  ultAfter: z.number().min(0),
});

export const SERVER_MESSAGES = {
  pong: z.strictObject({ t: z.number(), serverTime: serverTimeSchema }),

  'queue:status': z.strictObject({
    mode: z.enum(['ranked', 'casual']),
    elapsedMs: z.number().int().nonnegative(),
    searchRange: z.number().int().nonnegative(),
  }),

  'invite:created': z.strictObject({
    code: z.string().min(1).max(16),
    deepLink: z.string().min(1),
    expiresAt: serverTimeSchema,
  }),

  'match:found': z.strictObject({
    matchId: matchIdSchema,
    seat: seatSchema,
    opponent: z.strictObject({
      displayName: z.string().min(1).max(40),
      league: z.string().min(1).max(32),
      cosmetics: z.record(z.string(), z.string()),
    }),
    protocolVersion: z.string(),
    rulesVersion: z.string(),
    contentVersion: z.string(),
    ghost: z.boolean(),
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
    orbs: z.array(orbSpecSchema),
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
    matchId: matchIdSchema,
    seat: seatSchema,
    phase: z.enum(['intro', 'recharge', 'choice', 'reveal', 'ended']),
    round: roundSchema,
    endsAt: serverTimeSchema,
    roundsWon: roundsWonSchema,
    energy: z.number().int().min(0),
    ult: z.number().min(0),
    opponentLocked: z.boolean(),
    orbs: z.array(orbSpecSchema).optional(),
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

  'emote:received': z.strictObject({
    seat: seatSchema,
    emoteId: z.string().min(1).max(64),
  }),

  error: z.strictObject({
    code: errorCodeSchema,
    message: z.string(),
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

/** Analyse une charge utile serveur. Utilise par le client, qui recoit des noms du reseau. */
export function parseServerMessage(
  name: string,
  payload: unknown,
): ParseResult<ParsedServerMessage> {
  if (!isServerMessageName(name)) {
    return unknownMessage(name);
  }
  const parsed = SERVER_MESSAGES[name].safeParse(payload);
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
