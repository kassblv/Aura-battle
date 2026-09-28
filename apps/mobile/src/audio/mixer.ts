/**
 * Volume general et coupure du son.
 *
 * Etat pur, sans Web Audio : le moteur se contente de recopier `gain` dans son
 * noeud de sortie. Un jeu muet doit rester jouable, donc couper le son ne
 * change rien d autre que ce nombre.
 */

/**
 * Niveau de sortie a volume plein.
 *
 * Releve sur le prototype : en dessous de 1 pour laisser de la marge au
 * compresseur quand un choc et une fanfare tombent ensemble.
 */
export const MASTER_GAIN = 0.85;

/** Reglages du compresseur de sortie, releves sur le prototype. */
export const COMPRESSOR = { threshold: -14, ratio: 4 } as const;

/** Duree de la rampe appliquee a un changement de volume, en secondes. */
export const GAIN_RAMP_SECONDS = 0.02;

/**
 * Ramene un volume dans [0, 1].
 *
 * Une valeur hors bornes arrive vite d un curseur ou d un reglage relu sur le
 * disque ; un `NaN` pousse dans un `GainNode` leve une exception et tue le son
 * pour le reste de la partie.
 */
export function clampVolume(volume: number): number {
  if (!Number.isFinite(volume)) {
    return 0;
  }
  return Math.min(1, Math.max(0, volume));
}

export interface MixerState {
  readonly volume: number;
  readonly muted: boolean;
}

export interface Mixer extends MixerState {
  /** Niveau reellement envoye a la sortie. */
  readonly gain: number;
  /** Faux quand rien ne sortira : inutile de programmer des voix. */
  readonly audible: boolean;
  setVolume(volume: number): void;
  setMuted(muted: boolean): void;
}

export function gainOf(state: MixerState): number {
  return state.muted ? 0 : clampVolume(state.volume) * MASTER_GAIN;
}

export function createMixer(initial: Partial<MixerState> = {}): Mixer {
  let volume = clampVolume(initial.volume ?? 1);
  let muted = initial.muted ?? false;

  return {
    get volume(): number {
      return volume;
    },
    get muted(): boolean {
      return muted;
    },
    get gain(): number {
      return gainOf({ volume, muted });
    },
    get audible(): boolean {
      return gainOf({ volume, muted }) > 0;
    },
    setVolume(next: number): void {
      volume = clampVolume(next);
    },
    setMuted(next: boolean): void {
      muted = next;
    },
  };
}
