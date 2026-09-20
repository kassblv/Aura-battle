import type { Seat, TimingQuality } from '@aura/rules';
import type { ArenaEvent } from '../arena/events.js';
import type { SoundName } from './sounds.js';

/**
 * Ce que le match dit a l oreille.
 *
 * Meme principe que `arena/events.ts` : le son est pilote par des faits deja
 * tranches par le serveur, jamais par un calcul local. Le choix du son est une
 * fonction pure, donc verifiable sans carte son.
 */
export type AudioCue =
  | {
      readonly type: 'orbTap';
      /** Orbe doree : elle a son propre timbre, plus brillant. */
      readonly golden: boolean;
      /** Faux : le doigt est tombe a cote. */
      readonly hit: boolean;
      readonly combo: number;
    }
  | { readonly type: 'combo'; readonly combo: number }
  | { readonly type: 'rechargeEnd' }
  | { readonly type: 'lock' }
  | {
      readonly type: 'reveal';
      /** Vrai si c est le joueur de cet appareil qui se revele. */
      readonly local: boolean;
      readonly quality: TimingQuality;
      readonly ultimate: boolean;
    }
  | { readonly type: 'clash'; readonly counter: boolean }
  | { readonly type: 'matchEnd'; readonly outcome: 'win' | 'loss' | 'draw' };

export interface SoundRequest {
  readonly name: SoundName;
  /** Toujours defini : seul `tap` s en sert, les autres l ignorent. */
  readonly combo: number;
}

/** Tous les combien le combo se felicite lui-meme. */
export const COMBO_MILESTONE = 5;

/**
 * Le combo ne sonne qu a ses paliers.
 *
 * La montee de hauteur des taps dit deja le combo en continu ; un carillon a
 * chaque orbe le noierait au lieu de le souligner.
 */
export function isComboMilestone(combo: number): boolean {
  return Number.isInteger(combo) && combo > 0 && combo % COMBO_MILESTONE === 0;
}

/** Traduit un fait de match en son, ou `null` quand le silence est la reponse. */
export function soundForCue(cue: AudioCue): SoundRequest | null {
  switch (cue.type) {
    case 'orbTap':
      if (!cue.hit) {
        return { name: 'tapMiss', combo: 0 };
      }
      return cue.golden ? { name: 'tapGold', combo: cue.combo } : { name: 'tap', combo: cue.combo };

    case 'combo':
      return isComboMilestone(cue.combo) ? { name: 'chime', combo: cue.combo } : null;

    case 'rechargeEnd':
      return { name: 'rechargeEnd', combo: 0 };

    case 'lock':
      return { name: 'lock', combo: 0 };

    case 'reveal':
      if (cue.ultimate) {
        return { name: 'ultimate', combo: 0 };
      }
      // La qualite du timing est une information privee : on ne la sonne que
      // pour son proprietaire. L adversaire n a droit qu au souffle de
      // revelation, qui ne dit rien de sa reussite.
      return cue.local
        ? { name: qualitySound(cue.quality), combo: 0 }
        : { name: 'reveal', combo: 0 };

    case 'clash':
      return cue.counter ? { name: 'counter', combo: 0 } : { name: 'clash', combo: 0 };

    case 'matchEnd':
      switch (cue.outcome) {
        case 'win':
          return { name: 'victory', combo: 0 };
        case 'loss':
          return { name: 'defeat', combo: 0 };
        case 'draw':
          return null;
      }
  }
}

function qualitySound(quality: TimingQuality): SoundName {
  switch (quality) {
    case 'perfect':
      return 'perfect';
    case 'good':
      return 'good';
    case 'miss':
      return 'miss';
  }
}

/**
 * Passerelle depuis les evenements de l arene.
 *
 * L image et le son partent du meme fait : un seul evenement serveur nourrit
 * les deux, ce qui garantit qu ils ne peuvent pas raconter deux histoires
 * differentes.
 */
export function cueForArenaEvent(event: ArenaEvent, localSeat: Seat): AudioCue {
  switch (event.type) {
    case 'reveal':
      return {
        type: 'reveal',
        local: event.local,
        quality: event.quality,
        ultimate: event.ultimate,
      };
    case 'clash':
      return { type: 'clash', counter: event.counter !== null };
    case 'victory':
      if (event.seat === null) {
        return { type: 'matchEnd', outcome: 'draw' };
      }
      return { type: 'matchEnd', outcome: event.seat === localSeat ? 'win' : 'loss' };
  }
}
