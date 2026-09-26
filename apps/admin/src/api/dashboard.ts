import { z } from 'zod';

/**
 * Les trois lectures du tableau de bord (`/admin/status`, `/admin/indicators`,
 * `/admin/experiments`) n'ont pas de schema dans `@aura/protocol` : elles
 * precedent le contrat admin, et leurs formes vivent dans les services du
 * serveur (`AdminStatus`, `IndicatorReport`, `ExperimentReport`).
 *
 * On les decrit ici avec `z.object` (et non `strictObject`) : un champ ajoute
 * par le serveur est ignore, un champ manquant ou d'un mauvais type fait
 * echouer la lecture avec un message lisible — jamais un `undefined` affiche.
 */

const verdictSchema = z.enum(['ok', 'warn', 'down']);
export type Verdict = z.infer<typeof verdictSchema>;

export const adminStatusSchema = z.object({
  overall: verdictSchema,
  components: z.array(z.object({ name: z.string(), verdict: verdictSchema, detail: z.string() })),
  database: z
    .object({
      players: z.number(),
      matchesTotal: z.number(),
      matchesLastDay: z.number(),
      rankedPlayers: z.number(),
    })
    .nullable(),
  uptimeSeconds: z.number(),
  commit: z.string(),
  builtAt: z.string().nullable(),
  errors: z.object({
    total: z.number(),
    recent: z.array(z.object({ at: z.string(), message: z.string() })),
  }),
});
export type AdminStatus = z.infer<typeof adminStatusSchema>;

const measureSchema = z.object({ value: z.number().nullable(), n: z.number() });
export type Measure = z.infer<typeof measureSchema>;

export const unitSchema = z.enum(['ratio', 'perDay', 'ms']);
export type Unit = z.infer<typeof unitSchema>;

export const indicatorReportSchema = z.object({
  at: z.string(),
  indicators: z.array(
    z.object({
      id: z.string(),
      label: z.string(),
      unit: unitSchema,
      threshold: z.number(),
      comparison: z.enum(['gte', 'lte']),
      value: z.number().nullable(),
      n: z.number(),
      verdict: z.enum(['met', 'missed', 'insufficient']),
    }),
  ),
  ghostShare: measureSchema,
});
export type IndicatorReport = z.infer<typeof indicatorReportSchema>;
export type IndicatorLine = IndicatorReport['indicators'][number];

const groupSchema = z.object({
  players: z.number(),
  retentionD1: measureSchema,
  retentionD7: measureSchema,
  matchesPerActiveDay: measureSchema,
  abandonRate: measureSchema,
});
export type ExperimentGroupReading = z.infer<typeof groupSchema>;

export const experimentReportSchema = z.object({
  at: z.string(),
  experiments: z.array(
    z.object({
      flag: z.string(),
      rollout: z.number(),
      groups: z.object({ treatment: groupSchema, control: groupSchema }),
    }),
  ),
});
export type ExperimentReport = z.infer<typeof experimentReportSchema>;
