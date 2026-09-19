import type { Seat, TimingQuality } from '@aura/rules';
import { clamp, damp } from './math.js';

/**
 * Ce que l arene sait du match.
 *
 * Regle d or n°1 : le serveur fait autorite. L arene ne calcule aucun score,
 * aucun vainqueur, aucun contre ; elle recoit des faits deja tranches et decide
 * seulement de la mise en scene a jouer.
 */
export type ArenaEvent =
  | {
      readonly type: 'reveal';
      readonly seat: Seat;
      /** Vrai si c est le joueur de cet appareil : lui seul recoit le flash. */
      readonly local: boolean;
      /** Score annonce par le serveur. Sert de dosage visuel, rien de plus. */
      readonly score: number;
      readonly quality: TimingQuality;
      readonly ultimate: boolean;
    }
  | {
      readonly type: 'clash';
      readonly winner: Seat | null;
      readonly counter: Seat | null;
    }
  | {
      readonly type: 'victory';
      readonly seat: Seat | null;
    };

/** Demande de cadrage sur un siege, pour une duree donnee. */
export interface ArenaFocusRequest {
  readonly seat: Seat;
  readonly durationMs: number;
  readonly zoom: number;
}

/** Etat continu de la mise en scene, retombant image apres image. */
export interface ArenaShakeState {
  /** Secousse de camera. */
  readonly shake: number;
  /** Voile blanc plein ecran, entre 0 et 1. */
  readonly flash: number;
  /** Ferveur du public : anime la foule et le liseré de la plateforme. */
  readonly hype: number;
  /** Ralenti : 1 = vitesse normale. */
  readonly timeScale: number;
}

export interface ArenaImpulse extends ArenaShakeState {
  readonly focus: ArenaFocusRequest | null;
}

export const IDLE_IMPULSE: ArenaImpulse = Object.freeze({
  shake: 0,
  flash: 0,
  hype: 0,
  timeScale: 1,
  focus: null,
});

export interface ImpulseOptions {
  /** `prefers-reduced-motion` : coupe le flash plein ecran. */
  readonly reducedMotion: boolean;
}

/** Score au-dela duquel le public est a fond. */
const HYPE_SCORE = 110;

/** Traduit un evenement de match en mise en scene. Fonction pure. */
export function impulseFor(event: ArenaEvent, options: ImpulseOptions): ArenaImpulse {
  switch (event.type) {
    case 'reveal':
      return revealImpulse(event, options);
    case 'clash': {
      // Un contre est le moment le plus lisible du jeu : il frappe plus fort.
      const flash = options.reducedMotion ? 0 : 0.25;
      return {
        shake: event.counter ? 13 : 8,
        flash,
        hype: 1,
        timeScale: 0.15,
        // Le choc se joue entre les deux combattants : personne a suivre.
        focus: null,
      };
    }
    case 'victory':
      return event.seat === null
        ? IDLE_IMPULSE
        : {
            shake: 6,
            flash: 0,
            hype: 1,
            timeScale: 1,
            focus: { seat: event.seat, durationMs: 2600, zoom: 1.12 },
          };
  }
}

function revealImpulse(
  event: Extract<ArenaEvent, { type: 'reveal' }>,
  options: ImpulseOptions,
): ArenaImpulse {
  const perfect = event.quality === 'perfect';
  let shake = 0;
  let flash = 0;
  let timeScale = 1;

  if (perfect) {
    shake = 7;
    flash = 0.3;
    timeScale = 0.25;
  }
  if (event.ultimate) {
    shake = 14;
    flash = 0.5;
    timeScale = 0.1;
  }
  // Le voile plein ecran n a de sens que pour celui qui vient de jouer, et il
  // est coupe si l utilisateur demande moins d animation.
  if (!event.local || options.reducedMotion) {
    flash = 0;
  }

  return {
    shake,
    flash,
    timeScale,
    hype: clamp(event.score / HYPE_SCORE, 0, 1),
    focus: { seat: event.seat, durationMs: 1050, zoom: 1.16 },
  };
}

/**
 * Fusionne une impulsion dans l etat courant.
 *
 * On garde toujours le plus spectaculaire des deux : deux evenements peuvent
 * tomber dans la meme image (revelation puis Ultime), et le second ne doit pas
 * effacer la secousse du premier.
 */
export function applyImpulse(state: ArenaShakeState, impulse: ArenaImpulse): ArenaShakeState {
  return {
    shake: Math.max(state.shake, impulse.shake),
    flash: Math.max(state.flash, impulse.flash),
    hype: Math.max(state.hype, impulse.hype),
    timeScale: Math.min(state.timeScale, impulse.timeScale),
  };
}

/** Vitesses de retombee, reprises du prototype (par seconde). */
export const IMPULSE_DECAY = {
  shake: 22,
  flash: 1.6,
  hype: 0.35,
  /** Le ralenti revient a la vitesse normale en glissant, pas d un coup. */
  timeScaleRate: 5,
} as const;

export function decayImpulse(state: ArenaShakeState, deltaSeconds: number): ArenaShakeState {
  return {
    shake: Math.max(0, state.shake - IMPULSE_DECAY.shake * deltaSeconds),
    flash: Math.max(0, state.flash - IMPULSE_DECAY.flash * deltaSeconds),
    hype: Math.max(0, state.hype - IMPULSE_DECAY.hype * deltaSeconds),
    timeScale:
      state.timeScale + (1 - state.timeScale) * damp(IMPULSE_DECAY.timeScaleRate, deltaSeconds),
  };
}
