import { z } from 'zod';
import { rulesVariantSchema } from './primitives.js';

/**
 * Contrat du panneau d'administration (ADR 0018, spec 2026-09-26).
 *
 * Le panneau ecrit desormais : chaque requete est STRICTE et bornee — c'est la
 * porte la plus interessante du systeme. Les reponses sont lues par
 * l'application admin, elles aussi validees. Toute ecriture est journalisee
 * par le serveur (`AdminAction`), dans la meme transaction.
 */

const isoSchema = z.iso.datetime();
const reasonSchema = z.string().trim().min(3).max(200);

/* ---------- Drapeaux (experiences) ---------- */

export const adminFlagStateSchema = z.strictObject({
  flag: z.string().min(1).max(40),
  /** Part exposee en vigueur, 0 a 100 (0 : coupe). */
  rollout: z.number().int().min(0).max(100),
  /** Part de la mesure en cours : celle que « rallumer » retrouve. */
  measureRollout: z.number().int().min(1).max(100),
  /** Numero de la mesure : il monte a chaque nouvelle mesure. */
  epoch: z.number().int().min(1),
  measureStartedAt: isoSchema,
});
export type AdminFlagState = z.infer<typeof adminFlagStateSchema>;

export const adminFlagsResponseSchema = z.strictObject({
  flags: z.array(adminFlagStateSchema).max(32),
});

/**
 * Changer un drapeau. On ne regle JAMAIS la part d'une mesure en cours : cela
 * melange les groupes (relecture finale du chantier n°9). Couper, rallumer a la
 * part de la mesure, ou ouvrir une nouvelle mesure a une autre part.
 */
export const adminFlagUpdateRequestSchema = z.discriminatedUnion('action', [
  z.strictObject({ action: z.literal('pause'), reason: reasonSchema.optional() }),
  z.strictObject({ action: z.literal('resume'), reason: reasonSchema.optional() }),
  z.strictObject({
    action: z.literal('new-measure'),
    rollout: z.number().int().min(1).max(100),
    reason: reasonSchema.optional(),
  }),
]);
export type AdminFlagUpdateRequest = z.infer<typeof adminFlagUpdateRequestSchema>;

/* ---------- Evenement de la semaine ---------- */

/** La semaine telle que le JOUEUR la voit (`GET /events/week`) : rien de plus. */
export const weekEventSchema = z.strictObject({
  /** Numero de semaine UTC (lundi), celui de `weekIndexOf`. */
  week: z.number().int().min(0),
  /** Identifiant de `RULE_VARIANTS`, ou `normal`. */
  variant: rulesVariantSchema,
  endsAt: isoSchema,
});
export type WeekEvent = z.infer<typeof weekEventSchema>;

export const adminWeekEventSchema = z.strictObject({
  week: z.number().int().min(0),
  startsAt: isoSchema,
  variant: rulesVariantSchema,
  /** `rotation` : calculee ; `override` : forcee depuis le panneau. */
  source: z.enum(['rotation', 'override']),
});
export type AdminWeekEvent = z.infer<typeof adminWeekEventSchema>;

export const adminEventsResponseSchema = z.strictObject({
  weeks: z.array(adminWeekEventSchema).max(12),
  /** Les variantes qu'on peut forcer : `RULE_VARIANTS`, avec leur nom. */
  variants: z
    .array(z.strictObject({ id: rulesVariantSchema, name: z.string().max(60) }))
    .max(16),
});

/** Forcer une semaine : une variante, `normal`, ou `null` pour revenir a la rotation. */
export const adminEventOverrideRequestSchema = z.strictObject({
  variant: rulesVariantSchema.nullable(),
  reason: reasonSchema.optional(),
});
export type AdminEventOverrideRequest = z.infer<typeof adminEventOverrideRequestSchema>;

/* ---------- Joueurs ---------- */

export const adminPlayerSearchQuerySchema = z.strictObject({
  q: z.string().trim().min(1).max(64),
});

export const adminBanSchema = z.strictObject({
  /** `null` : definitif. */
  until: isoSchema.nullable(),
  reason: z.string().max(200),
  at: isoSchema,
});

export const adminPlayerSummarySchema = z.strictObject({
  id: z.string().min(1).max(64),
  displayName: z.string().max(40),
  createdAt: isoSchema,
  lastSeenAt: isoSchema,
  banned: z.boolean(),
});
export type AdminPlayerSummary = z.infer<typeof adminPlayerSummarySchema>;

export const adminPlayerSearchResponseSchema = z.strictObject({
  players: z.array(adminPlayerSummarySchema).max(20),
});

export const adminPlayerDetailSchema = z.strictObject({
  id: z.string().min(1).max(64),
  displayName: z.string().max(40),
  createdAt: isoSchema,
  lastSeenAt: isoSchema,
  level: z.number().int().min(1),
  xp: z.number().int().min(0),
  wallet: z.strictObject({ soft: z.number().int().min(0), hard: z.number().int().min(0) }),
  league: z.string().max(40).nullable(),
  ban: adminBanSchema.nullable(),
  recentMatches: z
    .array(
      z.strictObject({
        id: z.string().max(64),
        mode: z.enum(['RANKED', 'CASUAL', 'INVITE', 'SOLO']),
        startedAt: isoSchema,
        endReason: z.string().max(40).nullable(),
        /** Vu du joueur : gagne, perdu, ou nul/inacheve. */
        won: z.boolean().nullable(),
        ghost: z.boolean(),
      }),
    )
    .max(20),
});
export type AdminPlayerDetail = z.infer<typeof adminPlayerDetailSchema>;

/** Bannir jusqu'a une date, ou definitivement (`until: null`). Motif obligatoire. */
export const adminBanRequestSchema = z.strictObject({
  until: isoSchema.nullable(),
  reason: reasonSchema,
});
export type AdminBanRequest = z.infer<typeof adminBanRequestSchema>;

export const adminUnbanRequestSchema = z.strictObject({
  reason: reasonSchema,
});

/* ---------- Journal ---------- */

export const adminActionSchema = z.strictObject({
  id: z.string().max(64),
  at: isoSchema,
  /** `flag.pause`, `flag.resume`, `flag.new-measure`, `event.override`, `player.ban`, `player.unban`… */
  action: z.string().max(40),
  target: z.string().max(80),
  before: z.unknown(),
  after: z.unknown(),
  reason: z.string().max(200).nullable(),
});
export type AdminAction = z.infer<typeof adminActionSchema>;

export const adminAuditResponseSchema = z.strictObject({
  actions: z.array(adminActionSchema).max(100),
});
