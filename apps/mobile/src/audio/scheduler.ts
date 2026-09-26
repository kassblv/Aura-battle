import { voicesFor, type SoundName, type SoundOptions } from './sounds.js';
import { soundDuration, type Voice } from './voices.js';

/**
 * File d attente des sons.
 *
 * Elle decide *quand* un son part et, surtout, quand il ne part pas. Un duel
 * tape vite : sans budget, une rafale d orbes empile des dizaines
 * d oscillateurs, sature le melange et fait chuter les images par seconde sur
 * telephone. Le temps entre par parametre, donc tout est verifiable sans
 * horloge audio.
 */

export interface SchedulerLimits {
  /** Nombre de voix simultanees tolerees. Au-dela, le son est abandonne. */
  readonly maxVoices: number;
  /** Ecart minimal entre deux declenchements du meme son, en secondes. */
  readonly minGapSeconds: number;
  /**
   * Avance de programmation, en secondes.
   *
   * Programmer un son a l instant exact de l horloge audio le fait cliquer :
   * le prototype prend dix millisecondes d avance.
   */
  readonly lead: number;
}

export const DEFAULT_LIMITS: SchedulerLimits = {
  maxVoices: 24,
  minGapSeconds: 0.03,
  lead: 0.01,
};

export interface ScheduledSound {
  readonly name: SoundName;
  /** Instant de depart, sur l horloge du contexte audio, en secondes. */
  readonly at: number;
  readonly voices: readonly Voice[];
}

export interface SoundScheduler {
  /** Rend le son a programmer, ou `null` s il a ete abandonne. */
  schedule(name: SoundName, now: number, options?: SoundOptions): ScheduledSound | null;
  /** Nombre de voix encore en train de sonner a cet instant. */
  activeVoices(now: number): number;
  /** Oublie tout : apres une mise en veille, l horloge audio a saute. */
  reset(): void;
}

interface ActiveSound {
  readonly end: number;
  readonly count: number;
}

export function createSoundScheduler(limits: SchedulerLimits = DEFAULT_LIMITS): SoundScheduler {
  let active: ActiveSound[] = [];
  const lastStart = new Map<SoundName, number>();

  const prune = (now: number): void => {
    active = active.filter((sound) => sound.end > now);
  };

  const countVoices = (): number => active.reduce((total, sound) => total + sound.count, 0);

  return {
    schedule(name: SoundName, now: number, options: SoundOptions = {}): ScheduledSound | null {
      prune(now);
      const at = now + limits.lead;

      const previous = lastStart.get(name);
      if (previous !== undefined && at - previous < limits.minGapSeconds) {
        return null;
      }

      const voices = voicesFor(name, options);
      if (voices.length === 0) {
        return null;
      }
      // On refuse plutot que de tronquer : un son ampute s entend comme un
      // defaut, un son absent passe inapercu dans le vacarme.
      if (countVoices() + voices.length > limits.maxVoices) {
        return null;
      }

      lastStart.set(name, at);
      active.push({ end: at + soundDuration(voices), count: voices.length });
      return { name, at, voices };
    },

    activeVoices(now: number): number {
      prune(now);
      return countVoices();
    },

    reset(): void {
      active = [];
      lastStart.clear();
    },
  };
}
