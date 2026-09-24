import { BALANCE, type BalanceConfig } from './balance.js';
import type { Style } from './types.js';

/** Vrai si `attacker` contre `defender` (docs/01 §2). */
export function beats(attacker: Style, defender: Style, config: BalanceConfig = BALANCE): boolean {
  return config.styleBeats[attacker].includes(defender);
}

/** Les familles qui battent `style`, dans l'ordre du cercle. */
export function beatersOf(style: Style, config: BalanceConfig = BALANCE): readonly Style[] {
  return config.styles.filter((candidate) => beats(candidate, style, config));
}
