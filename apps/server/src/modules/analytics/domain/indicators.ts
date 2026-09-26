/**
 * Les indicateurs produit de docs/00-vision.md, et leur verdict.
 *
 * Pur : on donne des mesures, il rend un verdict. Les DEFINITIONS (qui compte
 * pour un actif, quels jours, quels matchs) vivent dans l'adaptateur qui
 * interroge la base et sont fixees par la spec
 * `docs/superpowers/specs/2026-09-26-indicateurs-produit-design.md` ; ici ne
 * vivent que les seuils et la regle qui les compare.
 */

/** Ordre de docs/00 : c'est aussi l'ordre d'affichage. */
export const INDICATOR_IDS = [
  'retentionD1',
  'retentionD7',
  'matchesPerActiveDay',
  'medianRankedWaitMs',
  'clipShareRate',
  'inviteInstallShare',
  'abandonRate',
] as const;

export type IndicatorId = (typeof INDICATOR_IDS)[number];

/**
 * Une mesure : sa valeur, et sur combien d'observations elle repose.
 *
 * `value` vaut `null` quand il n'y a rien a mesurer (aucune observation) :
 * zero serait une mesure, et une mesure fausse.
 */
export interface Measure {
  readonly value: number | null;
  readonly n: number;
}

/** `gte` : un plancher a atteindre. `lte` : un plafond a ne pas depasser. */
export type Comparison = 'gte' | 'lte';

/** Comment lire la valeur : une part (0..1), un nombre par jour, une duree. */
export type IndicatorUnit = 'ratio' | 'perDay' | 'ms';

export interface IndicatorTarget {
  readonly label: string;
  readonly unit: IndicatorUnit;
  readonly threshold: number;
  readonly comparison: Comparison;
}

/**
 * Les seuils de decision de docs/00-vision.md, tels quels.
 *
 * Des hypotheses de depart (docs/00 le dit) : les changer, c'est changer ce
 * tableau ET ce document, dans le meme commit.
 */
export const INDICATOR_TARGETS: Readonly<Record<IndicatorId, IndicatorTarget>> = Object.freeze({
  retentionD1: { label: 'Rétention J1', unit: 'ratio', threshold: 0.35, comparison: 'gte' },
  retentionD7: { label: 'Rétention J7', unit: 'ratio', threshold: 0.12, comparison: 'gte' },
  matchesPerActiveDay: {
    label: 'Matchs PvP par joueur actif et par jour',
    unit: 'perDay',
    threshold: 4,
    comparison: 'gte',
  },
  medianRankedWaitMs: {
    label: 'Attente médiane en file classée',
    unit: 'ms',
    threshold: 20_000,
    comparison: 'lte',
  },
  clipShareRate: {
    label: 'Matchs partagés en clip',
    unit: 'ratio',
    threshold: 0.03,
    comparison: 'gte',
  },
  inviteInstallShare: {
    label: 'Installations issues d’invitations',
    unit: 'ratio',
    threshold: 0.15,
    comparison: 'gte',
  },
  abandonRate: { label: 'Taux d’abandon', unit: 'ratio', threshold: 0.05, comparison: 'lte' },
});

/**
 * Effectif minimal avant de colorer un verdict.
 *
 * Sous vingt observations, une retention de 50 % peut etre un joueur sur deux :
 * un voyant vert sur deux comptes apprend a croire le tableau quand il ne sait
 * rien encore.
 */
export const MIN_SAMPLE = 20;

export type IndicatorVerdict = 'met' | 'missed' | 'insufficient';

export function verdictOf(measure: Measure, target: IndicatorTarget): IndicatorVerdict {
  if (measure.value === null || measure.n < MIN_SAMPLE) return 'insufficient';
  const met =
    target.comparison === 'gte'
      ? measure.value >= target.threshold
      : measure.value <= target.threshold;
  return met ? 'met' : 'missed';
}

/** Ce que le lecteur des indicateurs rend : une mesure par indicateur, plus le contexte. */
export interface IndicatorReadings {
  readonly indicators: Readonly<Record<IndicatorId, Measure>>;
  /** Part des matchs PvP des 7 jours joues contre un fantome : un contexte, pas un objectif. */
  readonly ghostShare: Measure;
}

export interface IndicatorLine extends IndicatorTarget, Measure {
  readonly id: IndicatorId;
  readonly verdict: IndicatorVerdict;
}

export interface IndicatorReport {
  /** Instant du calcul, heure serveur. */
  readonly at: string;
  readonly indicators: readonly IndicatorLine[];
  readonly ghostShare: Measure;
}

export function buildIndicatorReport(readings: IndicatorReadings, nowMs: number): IndicatorReport {
  return {
    at: new Date(nowMs).toISOString(),
    indicators: INDICATOR_IDS.map((id) => {
      const target = INDICATOR_TARGETS[id];
      const measure = readings.indicators[id];
      return {
        id,
        label: target.label,
        unit: target.unit,
        value: measure.value,
        n: measure.n,
        threshold: target.threshold,
        comparison: target.comparison,
        verdict: verdictOf(measure, target),
      };
    }),
    ghostShare: { value: readings.ghostShare.value, n: readings.ghostShare.n },
  };
}
