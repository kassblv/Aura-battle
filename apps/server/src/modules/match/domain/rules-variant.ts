import { RULE_VARIANTS, variantForWeek, weekIndexOf } from '@aura/rules';
import type { MatchRecord } from './ports.js';

const DAY_MS = 86_400_000;
const WEEK_MS = 7 * DAY_MS;
/** 1970-01-01 est un jeudi : quatre jours plus tard, le premier lundi (`weekIndexOf`). */
const FIRST_MONDAY_MS = 4 * DAY_MS;

/** Le lundi 00:00 UTC de la semaine `week`, au sens de `weekIndexOf`. */
export function weekStartMs(week: number): number {
  return FIRST_MONDAY_MS + week * WEEK_MS;
}

/**
 * Une variante qu'on peut forcer depuis le panneau (ADR 0018) : `normal`, ou
 * une de `RULE_VARIANTS`. Le panneau passe par les regles du jeu, jamais a
 * cote : une variante inventee n'existe pas.
 */
export function isForcibleVariant(id: string): boolean {
  return id === 'normal' || RULE_VARIANTS.some((variant) => variant.id === id);
}

/** La variante d'une semaine : la forcee si elle nomme encore une variante, sinon la rotation. */
function variantOfWeek(week: number, override: string | null): string {
  return override !== null && isForcibleVariant(override) ? override : variantForWeek(week);
}

/**
 * Les regles d'un match qui s'ouvre (evenements de la semaine, M10).
 *
 * La partie rapide seulement : le classe reste la reference — un LP gagne sous
 * d'autres regles ne vaudrait plus celui d'a cote — et une invitation entre
 * amis joue ce que chacun connait. La semaine se lit a l'OUVERTURE, en heure
 * serveur : un match commence un dimanche soir finit avec les regles de son
 * debut.
 *
 * `override` : la variante forcee pour CETTE semaine depuis le panneau, lue par
 * l'appelant (le domaine reste pur). Un forcage qui ne nomme plus aucune
 * variante — retiree du code depuis — est ignore : la rotation reprend.
 */
export function rulesVariantFor(
  mode: MatchRecord['mode'],
  atMs: number,
  override: string | null = null,
): string {
  if (mode !== 'CASUAL') return 'normal';
  return variantOfWeek(weekIndexOf(atMs), override);
}

/** La semaine telle que le joueur la voit (`GET /events/week`). */
export interface WeekEventView {
  readonly week: number;
  readonly variant: string;
  readonly endsAt: string;
}

/** La semaine qui contient `atMs`, sa variante (forcee ou non) et sa fin. */
export function weekEventAt(atMs: number, override: string | null): WeekEventView {
  const week = weekIndexOf(atMs);
  return {
    week,
    variant: variantOfWeek(week, override),
    endsAt: new Date(weekStartMs(week + 1)).toISOString(),
  };
}

/** Une semaine vue du panneau : sa variante, et d'ou elle vient. */
export interface AdminWeekView {
  readonly week: number;
  readonly startsAt: string;
  readonly variant: string;
  readonly source: 'rotation' | 'override';
}

/** La semaine `week` vue du panneau. */
export function adminWeekView(week: number, override: string | null): AdminWeekView {
  const forced = override !== null && isForcibleVariant(override);
  return {
    week,
    startsAt: new Date(weekStartMs(week)).toISOString(),
    variant: variantOfWeek(week, override),
    source: forced ? 'override' : 'rotation',
  };
}
