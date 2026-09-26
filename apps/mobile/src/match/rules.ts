import {
  BALANCE,
  RULE_VARIANTS,
  variantConfig,
  variantForWeek,
  weekIndexOf,
  type BalanceConfig,
} from '@aura/rules';

/** L'evenement de la semaine qui regit un match : ce que l'ecran en dit. */
export interface MatchEvent {
  readonly id: string;
  readonly name: string;
  readonly pitch: string;
}

/**
 * Les regles d'un match : la config a afficher, et l'evenement qui l'explique.
 *
 * Le serveur annonce un IDENTIFIANT (`match:found.rulesVariant`), jamais des
 * valeurs : les nombres se relisent dans `@aura/rules`, comme lui. Un
 * identifiant inconnu d'un client plus ancien retombe sur les regles normales
 * — l'ecran se tromperait d'un multiplicateur affiche, jamais d'un score, que
 * le serveur calcule seul.
 */
export interface MatchRules {
  readonly rules: BalanceConfig;
  readonly event: MatchEvent | null;
}

const NORMAL: MatchRules = Object.freeze({ rules: BALANCE, event: null });

/*
  Une entree par variante, calculee une fois. La vue est recalculee a chaque
  image : une config neuve a chaque appel changerait d'identite soixante fois
  par seconde et relancerait tous les `useMemo` qui en dependent.
*/
const BY_ID: ReadonlyMap<string, MatchRules> = new Map(
  RULE_VARIANTS.map((variant): [string, MatchRules] => [
    variant.id,
    Object.freeze({
      rules: variantConfig(variant.id),
      event: Object.freeze({ id: variant.id, name: variant.name, pitch: variant.pitch }),
    }),
  ]),
);

export function matchRules(variant: string | null): MatchRules {
  return (variant === null ? undefined : BY_ID.get(variant)) ?? NORMAL;
}

/**
 * L'evenement de la semaine en partie rapide, pour l'accueil, ou `null`.
 *
 * Une ANNONCE, pas une decision : c'est le serveur qui choisit la variante du
 * match, a l'instant ou il le cree. La meme rotation deterministe des deux
 * cotes, lue sur l'heure serveur estimee (`online.serverNow`) : seul un
 * telephone pas encore synchronise retombe sur son horloge murale, et le match
 * dira alors la sienne.
 */
export function weekEvent(nowMs: number): MatchEvent | null {
  return matchRules(variantForWeek(weekIndexOf(nowMs))).event;
}

/** Un multiplicateur tel que l'ecran l'ecrit : `×1,35`, `×1,5`. */
export function multiplierLabel(value: number): string {
  return `×${String(value).replace('.', ',')}`;
}
