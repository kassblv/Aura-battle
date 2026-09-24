import type { AmplifierLevel, Style, TimingQuality, Tier } from './types.js';

/**
 * Toutes les valeurs chiffrees du jeu, en un seul endroit.
 *
 * `docs/01-game-design.md` fait foi : changer une valeur ici impose de mettre a
 * jour le document, et l'inverse. `balance.test.ts` recopie chaque table du
 * document et echoue si les deux divergent.
 */

/** Gele un objet et tout ce qu'il contient, recursivement. */
function deepFreeze<T>(value: T): T {
  if (typeof value !== 'object' || value === null) {
    return value;
  }
  for (const nested of Object.values(value)) {
    deepFreeze(nested);
  }
  return Object.freeze(value);
}

export interface BalanceConfig {
  readonly match: {
    readonly roundsToWin: number;
    readonly maxRounds: number;
    readonly startingEnergy: number;
  };
  readonly phases: {
    readonly introMs: number;
    readonly rechargeMs: number;
    readonly choiceMs: number;
    readonly revealMs: number;
  };
  readonly styles: readonly Style[];
  /** Pour chaque famille, les deux qu'elle bat. */
  readonly styleBeats: Readonly<Record<Style, readonly Style[]>>;
  readonly counter: {
    readonly winnerMultiplier: number;
    readonly loserMultiplier: number;
  };
  readonly tierPower: Readonly<Record<Tier, number>>;
  readonly tierCost: Readonly<Record<Tier, number>>;
  /**
   * Multiplicateurs d'amplificateur.
   *
   * Volontairement resserres (voir docs/balance/2026-09-17-talent-contre-budget.md).
   * Un palier coute son propre numero, donc il **sature a 4** : deux joueurs qui
   * depensent 8 et 4 jouent tous deux au palier 4, et tout l'ecart de budget
   * part dans l'amplificateur. C'est donc lui, et lui seul, qui decide de ce que
   * vaut l'energie excedentaire — et de si le talent peut la compenser.
   */
  readonly amplifierMultiplier: Readonly<Record<AmplifierLevel, number>>;
  readonly amplifierCost: Readonly<Record<AmplifierLevel, number>>;
  /** Cout maximal d'un choix de manche (palier + amplificateur). */
  readonly maxRoundCost: number;
  readonly recharge: {
    readonly durationMs: number;
    readonly visibleOrbs: number;
    readonly normalOrb: { readonly points: number; readonly lifetimeMs: number };
    readonly goldenOrb: {
      readonly points: number;
      readonly lifetimeMs: number;
      readonly probability: number;
    };
    readonly comboThreshold: number;
    readonly comboBonusPoints: number;
    readonly boostPercentPerPoint: number;
    readonly boostPercentMax: number;
    readonly ultimatePerPoint: number;
    readonly ultimateMaxPerRecharge: number;
    readonly pointsPerEnergy: number;
    readonly energyMaxPerRound: number;
    readonly maxTapsPerSecond: number;
  };
  readonly timing: {
    readonly periodMinMs: number;
    readonly periodMaxMs: number;
    readonly zoneWidth: number;
    readonly perfectWidth: number;
    readonly centerMin: number;
    readonly centerMax: number;
    readonly qualityMultiplier: Readonly<Record<TimingQuality, number>>;
    readonly maxChargeMs: number;
  };
  readonly ultimate: {
    readonly gaugeMax: number;
    readonly gainOnPerfect: number;
    readonly gainOnCounter: number;
    readonly gainOnRoundLost: number;
    readonly multiplier: number;
  };
  /** Multiplicateur applique quand on rejoue un mouvement deja joue dans le match. */
  readonly repeatMultiplier: number;
  /**
   * Niveau de joueur (docs/01 §11).
   *
   * Le seul compteur qui MONTE MEME QUAND ON PERD — une defaite vaut 12
   * d'experience, une victoire 30. C'est le contrepoids des LP, qui
   * descendent : sans lui, une soiree de defaites ne laisse rien derriere
   * elle, et c'est comme ca qu'on arrete de jouer.
   */
  readonly progression: {
    /** Experience du premier palier, donc du niveau 1 au niveau 2. */
    readonly base: number;
    /** Ce que chaque palier coute de plus que le precedent. */
    readonly growth: number;
    /** Dernier niveau : au-dela, l'experience s'accumule sans rien changer. */
    readonly maxLevel: number;
  };
}

export const BALANCE: BalanceConfig = deepFreeze({
  match: {
    roundsToWin: 2,
    maxRounds: 3,
    startingEnergy: 14,
  },
  phases: {
    introMs: 2_000,
    rechargeMs: 6_000,
    choiceMs: 15_000,
    revealMs: 4_500,
  },
  styles: ['calme', 'hype', 'provoc', 'acrobatie', 'prouesse'],
  /*
    Le cercle : chaque famille bat la suivante et celle a trois crans. C'est la
    seule roue a cinq ou chacune a le meme profil — deux victoires, deux
    defaites —, ce qui laisse les multiplicateurs valoir pour toutes les
    paires. Les trois contres historiques (calme > hype > provoc > calme) y
    sont conserves.
  */
  styleBeats: {
    calme: ['hype', 'acrobatie'],
    hype: ['provoc', 'prouesse'],
    provoc: ['acrobatie', 'calme'],
    acrobatie: ['prouesse', 'hype'],
    prouesse: ['calme', 'provoc'],
  },
  counter: {
    winnerMultiplier: 1.35,
    loserMultiplier: 0.85,
  },
  tierPower: { 0: 11, 1: 20, 2: 30, 3: 42, 4: 56 },
  tierCost: { 0: 0, 1: 1, 2: 2, 3: 3, 4: 4 },
  amplifierMultiplier: { 0: 1.0, 1: 1.12, 2: 1.25, 3: 1.4, 4: 1.55 },
  amplifierCost: { 0: 0, 1: 1, 2: 2, 3: 3, 4: 4 },
  maxRoundCost: 8,
  recharge: {
    durationMs: 6_000,
    visibleOrbs: 3,
    normalOrb: { points: 1, lifetimeMs: 1_600 },
    goldenOrb: { points: 3, lifetimeMs: 950, probability: 0.13 },
    comboThreshold: 10,
    comboBonusPoints: 1,
    boostPercentPerPoint: 1,
    boostPercentMax: 25,
    ultimatePerPoint: 2.5,
    ultimateMaxPerRecharge: 40,
    pointsPerEnergy: 8,
    energyMaxPerRound: 2,
    maxTapsPerSecond: 12,
  },
  timing: {
    periodMinMs: 1_500,
    periodMaxMs: 1_900,
    zoneWidth: 0.22,
    perfectWidth: 0.08,
    centerMin: 0.3,
    centerMax: 0.7,
    qualityMultiplier: { perfect: 1.5, good: 1.15, miss: 0.6 },
    maxChargeMs: 6_000,
  },
  ultimate: {
    gaugeMax: 100,
    gainOnPerfect: 40,
    gainOnCounter: 35,
    gainOnRoundLost: 25,
    multiplier: 1.5,
  },
  repeatMultiplier: 0.7,
  /*
    Cent d'experience pour le premier palier : cinq matchs environ, donc le
    niveau 2 tombe dans la PREMIERE SESSION — la seule qui decide si quelqu'un
    revient.

    Huit pour cent de plus a chaque palier ensuite, et pas douze : a douze, le
    niveau 50 demandait 215 000 d'experience, soit plus de dix mille parties —
    environ trois cent cinquante heures. Un plafond que personne n'atteint
    n'est pas un horizon, c'est une decoration. A huit, il tombe vers deux mille
    six cents parties : long, mais atteignable par quelqu'un qui reste.
  */
  progression: { base: 100, growth: 1.08, maxLevel: 50 },
});
