import type { SoundAccent } from '@aura/content';
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
  | { readonly type: 'matchEnd'; readonly outcome: 'win' | 'loss' | 'draw' }
  /**
   * Un accent de geste, declare par l animation en cours (`sound`).
   *
   * Ce fait-la est different de tous les autres : il ne vient pas du serveur,
   * il vient de l image. Il ne peut donc servir que ce qui est DEJA a l ecran
   * — une revelation, ou le personnage de la vitrine d accueil.
   *
   * Et c est precisement pourquoi il ne transporte que `accent`. Un champ
   * `style`, `tier` ou `local` en ferait un canal de fuite : au moment du
   * verrouillage, l arene ne joue rien de l adversaire, et un son qui dirait
   * « il vient de choisir une acrobatie » vaudrait exactement le message que
   * le protocole se refuse a envoyer (regle d or n°4). Un accent ne dit que ce
   * que le corps fait, et un corps qu on ne voit pas ne fait rien.
   */
  | { readonly type: 'gesture'; readonly accent: SoundAccent };

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

    case 'gesture':
      return accentSound(cue.accent);

    // `matchEnd` reste en dernier : son aiguillage interne rend dans chaque
    // branche sans `break`, et un `case` pose apres lui se lit comme une
    // chute d un cas dans l autre.
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

/**
 * Le vocabulaire des accents, traduit en sons.
 *
 * Une table plutot qu un aiguillage, parce que la cle arrive d un fichier de
 * contenu : `loadAnimation` verifie l INSTANT d un accent, jamais son nom, et
 * c est voulu — le catalogue se publie sans mise a jour store (regle d or
 * n°5), donc une danse peut arriver avec un accent que cette version de
 * l application ne connait pas. Une table rend alors `undefined`, et la danse
 * se joue en silence au lieu d etre refusee.
 */
const ACCENT_SOUNDS: Readonly<Partial<Record<string, SoundName>>> = {
  whoosh: 'whoosh',
  impact: 'impact',
  hold: 'hold',
};

/** Le son d un accent de geste, ou le silence quand il est inconnu. */
function accentSound(accent: SoundAccent): SoundRequest | null {
  const name = ACCENT_SOUNDS[accent];
  return name === undefined ? null : { name, combo: 0 };
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
