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
      /**
       * Siege qui a lache son Ultime, s il y en a un et un seul.
       *
       * L Ultime vaut ×1,5 **et** annule le contre adverse : c est la plus
       * forte des trois issues, et le choc doit le montrer. Deux Ultimes dans
       * la meme manche ne designent personne — d ou `null` dans ce cas.
       */
      readonly ultimate: Seat | null;
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

/**
 * Duree du cadrage sur un combattant qui se revele.
 *
 * Le prototype tenait 1 050 ms parce que ses revelations etaient espacees de
 * 1 150 ms. Ici elles le sont de `REVEAL_GAP_MS` (700 ms) : le cadrage doit
 * lacher le premier danseur avant que le second se revele, et le second avant
 * que les auras se percutent — sinon le choc se joue hors champ.
 */
export const REVEAL_FOCUS_MS = 650;

/** Le vainqueur, lui, a tout le temps : plus rien ne se joue apres. */
export const VICTORY_FOCUS_MS = 2_600;

/** Traduit un evenement de match en mise en scene. Fonction pure. */
export function impulseFor(event: ArenaEvent, options: ImpulseOptions): ArenaImpulse {
  switch (event.type) {
    case 'reveal':
      return revealImpulse(event, options);
    case 'clash':
      return clashImpulse(event, options);
    case 'victory':
      return event.seat === null
        ? IDLE_IMPULSE
        : {
            shake: 6,
            flash: 0,
            hype: 1,
            timeScale: 1,
            focus: { seat: event.seat, durationMs: VICTORY_FOCUS_MS, zoom: 1.12 },
          };
  }
}

/**
 * Trois issues, trois intensites — et l ordre n est pas negociable.
 *
 * Le joueur doit pouvoir lire le resultat de la manche sans lire le bandeau.
 * L Ultime frappe plus fort que le contre, qui frappe plus fort qu une manche
 * gagnee au score ; une manche nulle, elle, ne recompense personne et se
 * contente d un heurt sourd.
 */
function clashImpulse(
  event: Extract<ArenaEvent, { type: 'clash' }>,
  options: ImpulseOptions,
): ArenaImpulse {
  const shake =
    event.ultimate !== null ? 16 : event.counter !== null ? 13 : event.winner !== null ? 8 : 5;
  const flash = event.ultimate !== null ? 0.35 : 0.25;
  return {
    shake,
    flash: options.reducedMotion ? 0 : flash,
    hype: 1,
    timeScale: event.ultimate !== null ? 0.12 : 0.15,
    // Le choc se joue entre les deux combattants : personne a suivre. Un
    // `focus` nul relache le cadrage pose par la revelation precedente.
    focus: null,
  };
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
    focus: { seat: event.seat, durationMs: REVEAL_FOCUS_MS, zoom: 1.16 },
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
