/**
 * Description d un son, sans Web Audio.
 *
 * Un son du jeu est une pile de « voix » : des oscillateurs qui glissent d une
 * frequence a une autre, et du bruit filtre. Les decrire en donnees plutot
 * qu en appels a l `AudioContext` permet de verifier la table de sons dans
 * Node, ou aucune carte son n existe.
 */

export type Waveform = 'sine' | 'square' | 'sawtooth' | 'triangle';

export type NoiseFilter = 'bandpass' | 'lowpass' | 'highpass';

interface VoiceCommon {
  /** Retard sur le debut du son, en secondes. Permet les arpeges. */
  readonly delay: number;
  readonly duration: number;
  /** Sommet de l enveloppe, entre `ENVELOPE_FLOOR` et 1. */
  readonly gain: number;
  /** Duree de la montee, en secondes. */
  readonly attack: number;
}

export interface ToneVoice extends VoiceCommon {
  readonly kind: 'tone';
  readonly wave: Waveform;
  readonly from: number;
  /** Egale a `from` quand la note ne glisse pas. */
  readonly to: number;
}

export interface NoiseVoice extends VoiceCommon {
  readonly kind: 'noise';
  readonly filter: NoiseFilter;
  /** Frequence de coupure au debut, puis a la fin du glissement. */
  readonly from: number;
  readonly to: number;
  readonly q: number;
  /** Point de lecture dans le tampon de bruit, en secondes. */
  readonly offset: number;
}

export type Voice = ToneVoice | NoiseVoice;

/**
 * Plancher des enveloppes.
 *
 * `exponentialRampToValueAtTime` refuse la valeur zero : le prototype vise
 * 0.0001, ce qui est inaudible. Toute voix doit donc culminer au-dessus, sinon
 * son enveloppe descend au lieu de monter.
 */
export const ENVELOPE_FLOOR = 0.0001;

const DEFAULT_ATTACK = 0.005;

/** Marge laissee a la queue de l enveloppe avant d arreter le noeud. */
export const VOICE_TAIL = 0.03;

interface ToneSpec {
  readonly delay?: number;
  readonly wave: Waveform;
  readonly from: number;
  readonly to?: number;
  readonly duration: number;
  readonly gain: number;
  readonly attack?: number;
}

export function tone(spec: ToneSpec): ToneVoice {
  return {
    kind: 'tone',
    delay: spec.delay ?? 0,
    wave: spec.wave,
    from: spec.from,
    to: spec.to ?? spec.from,
    duration: spec.duration,
    gain: spec.gain,
    attack: spec.attack ?? DEFAULT_ATTACK,
  };
}

interface NoiseSpec {
  readonly delay?: number;
  readonly filter?: NoiseFilter;
  readonly from: number;
  readonly to?: number;
  readonly q?: number;
  readonly duration: number;
  readonly gain: number;
  readonly attack?: number;
  readonly offset?: number;
}

export function noise(spec: NoiseSpec): NoiseVoice {
  return {
    kind: 'noise',
    delay: spec.delay ?? 0,
    filter: spec.filter ?? 'bandpass',
    from: spec.from,
    to: spec.to ?? spec.from,
    q: spec.q ?? 1,
    duration: spec.duration,
    gain: spec.gain,
    attack: spec.attack ?? DEFAULT_ATTACK,
    offset: spec.offset ?? 0,
  };
}

/** Instant, relatif au debut du son, ou la voix peut etre liberee. */
export function voiceEnd(voice: Voice): number {
  return voice.delay + voice.duration + VOICE_TAIL;
}

/** Duree totale d un son, queues comprises. */
export function soundDuration(voices: readonly Voice[]): number {
  return voices.reduce((longest, voice) => Math.max(longest, voiceEnd(voice)), 0);
}
