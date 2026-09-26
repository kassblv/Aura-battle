/**
 * Vocabulaire du domaine. Ces types sont partages par le serveur (verite) et le
 * client (prevision), via @aura/protocol.
 */

/** Les deux places d'un match. Le siege est stable pour toute sa duree. */
export type Seat = 'a' | 'b';

/**
 * Famille d'un mouvement. Chaque famille en bat deux autres et perd contre les
 * deux dernieres (voir BALANCE.styleBeats).
 */
export type Style = 'calme' | 'hype' | 'provoc' | 'acrobatie' | 'prouesse';

/** Palier d'un mouvement : plus il est haut, plus il est puissant et cher. */
export type Tier = 0 | 1 | 2 | 3 | 4;

/** Niveau d'amplificateur d'aura. */
export type AmplifierLevel = 0 | 1 | 2 | 3 | 4;

/** Qualite d'un tap sur la jauge de timing. */
export type TimingQuality = 'perfect' | 'good' | 'miss';

/**
 * Un mouvement, c'est-a-dire ce qui compte pour le score.
 * L'animation jouee n'est qu'un skin : deux animations du meme mouvement sont
 * strictement equivalentes (docs/01-game-design.md §2).
 */
export interface Move {
  readonly style: Style;
  readonly tier: Tier;
}

/**
 * Ce qu'un joueur verrouille a la phase de choix.
 * Reste secret jusqu'a la revelation : c'est tout l'interet du bluff.
 */
export interface Choice {
  readonly move: Move;
  readonly amplifier: AmplifierLevel;
  /** Ne peut etre vrai que si la jauge d'Ultime est pleine. */
  readonly useUltimate: boolean;
}

/** Renvoie le siege adverse. */
export function opponentOf(seat: Seat): Seat {
  return seat === 'a' ? 'b' : 'a';
}
