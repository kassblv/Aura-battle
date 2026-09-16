import { BALANCE } from '@aura/rules';
import { z } from 'zod';
import {
  amplifierSchema,
  contentIdSchema,
  cosmeticSchema,
  matchIdSchema,
  moveSchema,
  roundSchema,
  seqSchema,
  styleSchema,
  parseFailure,
  unknownMessage,
  type ParseResult,
} from './primitives.js';

/**
 * Messages client -> serveur (docs/03-pvp-protocol.md).
 *
 * Le client n'envoie que des **intentions** : ou il a tape, quand, et ce qu'il
 * a choisi. Aucun schema n'accepte de score, de qualite de timing, de points de
 * recharge ni de cout : ces valeurs sont calculees par le serveur, et un client
 * qui essaierait de les fournir voit son message rejete (regle d'or n°1).
 */

/**
 * Nombre maximal de taps qu'une recharge peut physiquement produire.
 * Au-dela, la charge utile est refusee : ce n'est plus un joueur.
 */
export const MAX_TAPS_PER_MESSAGE =
  (BALANCE.recharge.maxTapsPerSecond * BALANCE.recharge.durationMs) / 1_000;

/** Delai minimal entre le lancement de la charge et le tap. En deca, c'est un robot. */
export const MIN_CHARGE_TO_TAP_MS = 120;

/**
 * Indice d'orbe maximal.
 *
 * La sequence d'une manche est bornee ; un indice au-dela ne designe rien.
 * Le plafonner ici evite qu'un entier absurde serve un jour a dimensionner ou
 * indexer un tableau cote serveur.
 */
const MAX_ORB_INDEX =
  BALANCE.recharge.visibleOrbs +
  (BALANCE.recharge.maxTapsPerSecond * BALANCE.recharge.durationMs) / 1_000 +
  Math.floor(
    (BALANCE.recharge.visibleOrbs * BALANCE.recharge.durationMs) /
      Math.min(BALANCE.recharge.normalOrb.lifetimeMs, BALANCE.recharge.goldenOrb.lifetimeMs),
  );

const tapSchema = z.strictObject({
  orbIndex: z.number().int().nonnegative().max(MAX_ORB_INDEX),
  /** Millisecondes depuis le debut de la phase, mesurees avec `performance.now()`. */
  t: z.number().min(0).max(BALANCE.recharge.durationMs),
});

const timingSchema = z
  .strictObject({
    // La charge se lance pendant la phase de choix : au-dela de sa duree,
    // l'instant ne peut pas etre relatif a son debut.
    chargeAt: z.number().min(0).max(BALANCE.phases.choiceMs),
    tapAt: z.number().min(0).nullable(),
  })
  .refine(
    ({ chargeAt, tapAt }) =>
      tapAt === null ||
      (tapAt - chargeAt >= MIN_CHARGE_TO_TAP_MS && tapAt - chargeAt <= BALANCE.timing.maxChargeMs),
    {
      message: `Le tap doit arriver entre ${MIN_CHARGE_TO_TAP_MS} et ${BALANCE.timing.maxChargeMs} ms apres le lancement de la charge`,
      path: ['tapAt'],
    },
  );

export const CLIENT_MESSAGES = {
  ping: z.strictObject({ t: z.number() }),

  'queue:join': z.strictObject({ mode: z.enum(['ranked', 'casual']) }),
  'queue:leave': z.strictObject({}),

  'invite:create': z.strictObject({}),
  // Un code d'invitation se dicte a voix haute : majuscules et chiffres.
  'invite:join': z.strictObject({
    code: z.string().regex(/^[A-Z0-9]{4,16}$/, "code d'invitation invalide"),
  }),

  'match:ready': z.strictObject({ matchId: matchIdSchema }),
  'match:rejoin': z.strictObject({ matchId: matchIdSchema }),
  'match:forfeit': z.strictObject({ matchId: matchIdSchema }),

  'recharge:taps': z.strictObject({
    matchId: matchIdSchema,
    round: roundSchema,
    seq: seqSchema,
    taps: z
      .array(tapSchema)
      .max(MAX_TAPS_PER_MESSAGE)
      // La monotonie est verifiable sans etat : autant la refuser ici plutot
      // que de faire confiance a l'ordre d'arrivee (docs/03, validation serveur).
      .refine((list) => list.every((tap, index) => index === 0 || tap.t >= list[index - 1]!.t), {
        message: 'les instants de tap doivent etre croissants',
      }),
  }),

  'choice:lock': z.strictObject({
    matchId: matchIdSchema,
    round: roundSchema,
    seq: seqSchema,
    move: moveSchema,
    amp: amplifierSchema,
    ult: z.boolean(),
    cosmetic: cosmeticSchema.optional(),
    timing: timingSchema,
  }),

  /**
   * Bulle d'intention (docs/01 §10).
   *
   * Le `seq` n'est pas decoratif : gagner la manche avec le style annonce
   * rapporte +10 de jauge d'Ultime. Sans numero d'ordre, rien n'empeche
   * d'annoncer les trois styles et d'encaisser le bonus a tous les coups. Le
   * serveur ne retient que la premiere annonce d'une manche, et le `seq` lui
   * permet de rester idempotent apres une reconnexion.
   */
  'intent:show': z.strictObject({
    matchId: matchIdSchema,
    round: roundSchema,
    seq: seqSchema,
    style: styleSchema,
  }),

  'emote:send': z.strictObject({
    matchId: matchIdSchema,
    emoteId: contentIdSchema,
  }),
} as const;

export type ClientMessageName = keyof typeof CLIENT_MESSAGES;

export type ClientMessage<N extends ClientMessageName> = z.infer<(typeof CLIENT_MESSAGES)[N]>;

export const CLIENT_MESSAGE_NAMES = Object.keys(CLIENT_MESSAGES) as readonly ClientMessageName[];

/** Vrai si ce nom d'evenement existe au registre. */
export function isClientMessageName(name: string): name is ClientMessageName {
  return Object.hasOwn(CLIENT_MESSAGES, name);
}

/**
 * Un message client analyse, nom compris.
 *
 * L'union est discriminee par `name` : la passerelle fait un `switch` dessus et
 * obtient `data` correctement type dans chaque branche, sans transtypage.
 */
export type ParsedClientMessage = {
  [N in ClientMessageName]: { readonly name: N; readonly data: ClientMessage<N> };
}[ClientMessageName];

/**
 * Analyse une charge utile entrante contre le schema de son evenement.
 *
 * `name` est une chaine et non un nom du registre : il arrive du reseau, donc
 * rien ne garantit qu'il existe. C'est precisement ce que cette fonction verifie.
 */
export function parseClientMessage(
  name: string,
  payload: unknown,
): ParseResult<ParsedClientMessage> {
  if (!isClientMessageName(name)) {
    return unknownMessage(name);
  }
  const parsed = CLIENT_MESSAGES[name].safeParse(payload);
  return parsed.success
    ? { success: true, data: { name, data: parsed.data } as ParsedClientMessage }
    : parseFailure(parsed.error);
}
