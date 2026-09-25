import { BALANCE, EVENT_BALANCE, type BalanceConfig } from './balance.js';

/**
 * Les evenements de la semaine (chantier n°7, M10) : des variantes de regles
 * declarees en donnee.
 *
 * Une variante ne change que des NOMBRES de `BalanceConfig`, que l'ecran sait
 * deja afficher : jamais la forme du jeu. Elle se joue en partie rapide
 * seulement ; le classe reste la reference. Tout changement ici est un
 * changement d'equilibrage (regle d'or n°6) : test, simulateur, docs/01.
 */
export interface RuleVariant {
  readonly id: string;
  readonly name: string;
  /** Une phrase pour l'accueil : ce qui change, dit au joueur. */
  readonly pitch: string;
  readonly apply: (base: BalanceConfig) => BalanceConfig;
}

/** Un nombre a la francaise pour une annonce (`1.5` → `1,5`). */
const fr = (value: number): string => String(value).replace('.', ',');

export const RULE_VARIANTS: readonly RuleVariant[] = Object.freeze([
  {
    // Pas d'energie en plus : mesure, elle faisait passer « toujours le plus
    // gros » de 75 % a 84 %. Une jauge plus courte ajoute des decisions (quand
    // lacher l'Ultime ?) au lieu d'en retirer.
    id: 'ultime',
    name: 'Ultime express',
    pitch: `La jauge d’Ultime se remplit à ${fr(EVENT_BALANCE.ultimeGaugeMax)} au lieu de ${fr(BALANCE.ultimate.gaugeMax)} : il sort plus souvent.`,
    apply: (base) => ({
      ...base,
      ultimate: { ...base.ultimate, gaugeMax: EVENT_BALANCE.ultimeGaugeMax },
    }),
  },
  {
    id: 'brillance',
    name: 'Semaine brillante',
    pitch: `La carte brillante vaut ×${fr(EVENT_BALANCE.brillanceMultiplier)} au lieu de ×${fr(BALANCE.shiny.multiplier)}.`,
    apply: (base) => ({
      ...base,
      shiny: { ...base.shiny, multiplier: EVENT_BALANCE.brillanceMultiplier },
    }),
  },
  {
    id: 'contres',
    name: 'Contres tranchants',
    pitch: `Un contre vaut ×${fr(EVENT_BALANCE.contresMultiplier)} au lieu de ×${fr(BALANCE.counter.winnerMultiplier)} : lire l’adversaire paie plus.`,
    apply: (base) => ({
      ...base,
      counter: { ...base.counter, winnerMultiplier: EVENT_BALANCE.contresMultiplier },
    }),
  },
]);

/** La config d'une variante ; la normale pour `normal` ou un identifiant inconnu. */
export function variantConfig(id: string, base: BalanceConfig = BALANCE): BalanceConfig {
  const variant = RULE_VARIANTS.find((candidate) => candidate.id === id);
  return variant === undefined ? base : variant.apply(base);
}

const DAY_MS = 86_400_000;
/** 1970-01-01 est un jeudi : trois jours plus tard, le premier lundi. */
const FIRST_MONDAY_MS = 4 * DAY_MS;

/** Numero de la semaine UTC, du lundi au dimanche. */
export function weekIndexOf(atMs: number): number {
  return Math.floor((atMs - FIRST_MONDAY_MS) / (7 * DAY_MS));
}

/**
 * La variante d'une semaine : une semaine sur deux normale, pour que
 * l'evenement reste un evenement ; les autres parcourent les variantes dans
 * l'ordre. Deterministe : rien a stocker, rien a planifier.
 */
export function variantForWeek(week: number): string {
  const safe = Math.trunc(week);
  if (safe % 2 === 0) return 'normal';
  const index = Math.floor(safe / 2) % RULE_VARIANTS.length;
  return RULE_VARIANTS[(index + RULE_VARIANTS.length) % RULE_VARIANTS.length]?.id ?? 'normal';
}
