import { BALANCE, type BalanceConfig } from './balance.js';
import type { Rng } from './rng.js';
import type { TimingQuality } from './types.js';

/**
 * Jauge de timing (docs/01-game-design.md §5).
 *
 * Un curseur fait des allers-retours a vitesse constante ; le joueur tape pour
 * l'arreter. Plus il est proche du centre, meilleur est son multiplicateur.
 * Les parametres sont tires par graine et envoyes au client au debut de la
 * phase de choix : les deux joueurs affrontent la meme jauge dans une manche.
 */

export interface GaugeParams {
  /** Duree d'un aller-retour complet du curseur, en millisecondes. */
  readonly periodMs: number;
  /** Position visee, dans [0, 1]. */
  readonly center: number;
  /** Largeur totale de la zone « Bon ». */
  readonly zoneWidth: number;
  /** Largeur totale de la zone « Parfait ». */
  readonly perfectWidth: number;
}

export interface TimingResult {
  readonly quality: TimingQuality;
  /** Ecart absolu entre le curseur et le centre, dans [0, 1]. Sert au departage. */
  readonly delta: number;
  readonly multiplier: number;
}

/**
 * Position du curseur : onde triangulaire de periode `periodMs`.
 *
 * `p(t) = u < 0,5 ? 2u : 2 − 2u` avec `u = (t mod periode) / periode`.
 * Le curseur part de 0, atteint 1 a la demi-periode, revient a 0.
 */
export function cursorPosition(elapsedMs: number, periodMs: number): number {
  const u = (elapsedMs % periodMs) / periodMs;
  return u < 0.5 ? 2 * u : 2 - 2 * u;
}

/**
 * Ecart attribue a un joueur qui n'a pas tape (ou trop tard).
 * C'est le pire ecart possible : il ne peut jamais gagner un departage.
 */
const WORST_DELTA = 1;

/**
 * Tolerance appliquee aux comparaisons de frontiere.
 *
 * `0,54 - 0,5` vaut `0,040000000000000036` en flottant : un tap pile au bord de
 * la zone parfaite serait classe « Bon » a cause d'une erreur de 3,6e-17, soit
 * un multiplicateur de x1,15 au lieu de x1,50. On tranche explicitement en
 * faveur du joueur : a la frontiere, la meilleure qualite l'emporte.
 */
const BOUNDARY_EPSILON = 1e-9;

/**
 * Evalue un tap sur la jauge.
 *
 * @param tapAtMs Instant du tap, en millisecondes depuis le lancement de la
 *   charge. `null` si le joueur n'a pas tape.
 */
export function evaluateTiming(
  tapAtMs: number | null,
  params: GaugeParams,
  config: BalanceConfig = BALANCE,
): TimingResult {
  if (tapAtMs !== null && tapAtMs < 0) {
    throw new RangeError(`Instant de tap negatif : ${tapAtMs}`);
  }

  if (tapAtMs === null || tapAtMs > config.timing.maxChargeMs) {
    return {
      quality: 'miss',
      delta: WORST_DELTA,
      multiplier: config.timing.qualityMultiplier.miss,
    };
  }

  const delta = Math.abs(cursorPosition(tapAtMs, params.periodMs) - params.center);
  const quality: TimingQuality =
    delta <= params.perfectWidth / 2 + BOUNDARY_EPSILON
      ? 'perfect'
      : delta <= params.zoneWidth / 2 + BOUNDARY_EPSILON
        ? 'good'
        : 'miss';

  return { quality, delta, multiplier: config.timing.qualityMultiplier[quality] };
}

/** Tire les parametres de jauge d'une manche a partir du RNG de cette manche. */
export function generateGaugeParams(rng: Rng, config: BalanceConfig = BALANCE): GaugeParams {
  const { timing } = config;
  return {
    periodMs: rng.nextInt(timing.periodMinMs, timing.periodMaxMs),
    center: timing.centerMin + rng.nextFloat() * (timing.centerMax - timing.centerMin),
    zoneWidth: timing.zoneWidth,
    perfectWidth: timing.perfectWidth,
  };
}
