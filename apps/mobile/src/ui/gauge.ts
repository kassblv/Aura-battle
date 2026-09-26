import { BALANCE, cursorPosition, type BalanceConfig, type GaugeParams } from '@aura/rules';

/**
 * Geometrie de la jauge de timing.
 *
 * Le curseur et les zones doivent vivre dans **le meme repere**, sinon la
 * jauge ment : le joueur vise ce qu'il voit, le serveur note ce qu'il calcule.
 * C'est exactement ce qui arrivait quand les zones etaient peintes en dur dans
 * la feuille de style (30 %-70 % pour « bon », 45,5 %-54,5 % pour « parfait »)
 * alors que le moteur tire un centre par manche entre 0,30 et 0,70 et applique
 * des largeurs de 0,22 et 0,08. Les deux se rejoignaient une manche sur
 * beaucoup, et jamais exactement.
 *
 * D'ou ce module : une seule fonction convertit les parametres du moteur en
 * bandes, la feuille de style ne decide plus d'aucune position, et un test
 * confronte les bandes peintes a `evaluateTiming`.
 */

/** Ce que la jauge a besoin de savoir pour se dessiner : l'espace, pas le temps. */
export type MeterZones = Pick<GaugeParams, 'center' | 'zoneWidth' | 'perfectWidth'>;

/** Une bande de la piste, en fractions de sa largeur. */
export interface Band {
  readonly left: number;
  readonly width: number;
}

export interface GaugeBands {
  readonly good: Band;
  readonly perfect: Band;
}

/**
 * Jauge de repli, centree.
 *
 * Elle sert tant que le centre de la manche n'a pas ete recu. C'est un dessin,
 * pas la verite : les largeurs restent celles du moteur pour qu'un repli n'ait
 * jamais l'air d'une autre jauge.
 */
export const CENTERED_ZONES: MeterZones = Object.freeze({
  center: 0.5,
  zoneWidth: BALANCE.timing.zoneWidth,
  perfectWidth: BALANCE.timing.perfectWidth,
});

/**
 * Geometrie incomplete : `undefined` est une valeur attendue ici, pas un oubli.
 * `exactOptionalPropertyTypes` distingue les deux, et l'appelant lit des champs
 * qui peuvent manquer.
 */
export type PartialZones = { readonly [K in keyof MeterZones]?: number | undefined };

/**
 * Complete une geometrie partielle par le repli centre.
 *
 * Le centre arrive avec `choice:start` : avant ce message il n'y a rien a
 * dessiner de vrai, et apres il n'y a plus de raison de dessiner autre chose.
 */
export function resolveZones(
  partial: PartialZones,
  /** Les regles du match : le repli prend SES largeurs, pas celles par defaut. */
  rules: BalanceConfig = BALANCE,
): MeterZones {
  return {
    center: partial.center ?? CENTERED_ZONES.center,
    zoneWidth: partial.zoneWidth ?? rules.timing.zoneWidth,
    perfectWidth: partial.perfectWidth ?? rules.timing.perfectWidth,
  };
}

const clamp01 = (value: number): number => Math.min(1, Math.max(0, value));

/** Bande centree sur `center`, rognee aux bords de la piste. */
function band(center: number, width: number): Band {
  const left = clamp01(center - width / 2);
  const right = clamp01(center + width / 2);
  return { left, width: right - left };
}

export function gaugeBands(zones: MeterZones): GaugeBands {
  return {
    good: band(zones.center, zones.zoneWidth),
    perfect: band(zones.center, zones.perfectWidth),
  };
}

/**
 * Position du curseur, dans [0, 1].
 *
 * **L'horloge part de l'armement, pas du debut de la phase.** Le serveur note
 * `evaluateTiming(tapAt - chargeAt, ...)` (`match.gateway.ts`) : dessiner le
 * curseur sur l'horloge de phase donnait donc une aiguille decalee de tout le
 * temps de reflexion du joueur — soit, avec une periode de 1,7 s, une position
 * sans rapport avec celle qui sera notee. C'est ce qui rend la jauge inutile
 * avant le choix du mouvement, et c'est pour ca qu'elle n'apparait qu'apres.
 *
 * Le garde-fou sur la periode vaut pour la fenetre ou la phase de choix a
 * commence mais ou `choice:start` n'est pas encore arrive : `periodMs` y vaut
 * 0, et une division par zero dessinerait un curseur `NaN`.
 */
export function needlePosition(sinceChargeMs: number, periodMs: number): number {
  if (periodMs <= 0 || sinceChargeMs < 0) return 0;
  return cursorPosition(sinceChargeMs, periodMs);
}

/**
 * Horloge de la jauge : `null` tant que rien n'est arme.
 *
 * Elle existe pour que l'ecran n'ait pas a refaire la soustraction — c'est
 * exactement celle que `match.gateway.ts` fait cote serveur, et une horloge
 * qu'on recalcule a deux endroits finit par diverger. `null` n'est pas zero :
 * avant l'armement il n'y a pas de curseur a montrer, et c'est ce qui decide
 * si la jauge est a l'ecran.
 */
export function chargeClock(inPhaseMs: number, chargeAtMs: number | null): number | null {
  if (chargeAtMs === null) return null;
  return Math.max(0, inPhaseMs - chargeAtMs);
}

/** Fraction en pourcentage CSS, arrondie au centieme. */
export function percent(fraction: number): string {
  return `${(fraction * 100).toFixed(2)}%`;
}
