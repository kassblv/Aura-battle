import { BALANCE, type AmplifierLevel, type BalanceConfig, type Tier } from '@aura/rules';

/**
 * La mise d'une manche.
 *
 * Palier et amplificateur se payaient sur la meme energie sans que rien ne le
 * montre : deux rangees de pastilles, un cout par bouton, et au joueur de
 * faire l'addition. Or ce n'est pas un formulaire qu'il remplit — c'est une
 * mise qu'il pose. Ce module calcule ce qu'il mise et ce que ca lui coute, en
 * une seule lecture.
 *
 * Aucune autorite ici : le serveur recalcule tout (regle d'or n°1). C'est une
 * **previsualisation**, faite avec les memes constantes que lui, et elle ne
 * porte que le choix du joueur local — rien de l'adversaire, donc rien a
 * divulguer.
 */

/**
 * Etat d'un point d'energie.
 *
 * `locked` n'est pas `free` : c'est une energie que le joueur **n'a pas**,
 * parce que sa reserve est en dessous du plafond de manche. La distinction est
 * tout l'interet de la jauge — sans elle, il faut faire la soustraction.
 */
export type PipState = 'tier' | 'amplifier' | 'free' | 'locked';

export interface Bet {
  /**
   * Puissance misee, avant timing, contre et Ultime.
   *
   * C'est la tete de la formule de `round.ts` : `tierPower x amplifier`. Le
   * reste depend de la main du joueur et du choix d'en face, donc ne peut pas
   * s'afficher avant la revelation.
   */
  readonly power: number;
  readonly cost: number;
  readonly affordable: boolean;
  readonly pips: readonly PipState[];
}

export function betFor(
  tier: Tier,
  amplifier: AmplifierLevel,
  cap: number,
  config: BalanceConfig = BALANCE,
): Bet {
  const cost = tier + amplifier;
  const pips: PipState[] = [];
  for (let index = 0; index < config.maxRoundCost; index += 1) {
    if (index < tier) pips.push('tier');
    else if (index < cost) pips.push('amplifier');
    else pips.push(index < cap ? 'free' : 'locked');
  }

  return {
    power: Math.round(config.tierPower[tier] * config.amplifierMultiplier[amplifier]),
    cost,
    affordable: cost <= cap,
    pips,
  };
}

/**
 * Remplissage d'un cran, entre 0 et 1.
 *
 * Cinq pastilles alignees ne disent pas qu'elles forment une **echelle**. Une
 * barre qui monte d'un cran a l'autre le dit sans un mot, et sans couter un
 * pixel de hauteur au bouton.
 */
export function levelFill(level: number, levels: number): number {
  if (levels <= 1) return 1;
  return Math.min(1, Math.max(0, level / (levels - 1)));
}
