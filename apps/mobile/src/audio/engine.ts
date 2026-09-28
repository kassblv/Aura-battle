import { soundForCue, type AudioCue } from './cues.js';
import { COMPRESSOR, GAIN_RAMP_SECONDS, createMixer, type Mixer } from './mixer.js';
import { DEFAULT_LIMITS, createSoundScheduler, type SchedulerLimits } from './scheduler.js';
import type { SoundName, SoundOptions } from './sounds.js';
import { ENVELOPE_FLOOR, VOICE_TAIL, type Voice } from './voices.js';

/**
 * Moteur audio.
 *
 * Seul module qui touche la Web Audio API : il n est donc pas couvert par les
 * tests, qui tournent sans navigateur, exactement comme `arena/renderer.ts`.
 * Tout ce qui pouvait etre calcule sans carte son vit ailleurs (`sounds`,
 * `cues`, `mixer`, `scheduler`) et est teste la-bas.
 *
 * Piege iOS : un `AudioContext` cree hors d un geste utilisateur naitra suspendu
 * et le reste. Le contexte n est donc construit qu au premier `resume()`, que
 * l application appelle sur le premier appui. Avant cela, `play()` ne fait
 * rien — et ne doit rien faire : personne ne l aurait entendu.
 */

type AudioContextConstructor = new () => AudioContext;

interface AudioGlobal {
  readonly AudioContext?: AudioContextConstructor;
  readonly webkitAudioContext?: AudioContextConstructor;
}

function audioContextConstructor(): AudioContextConstructor | null {
  const candidate = globalThis as AudioGlobal;
  return candidate.AudioContext ?? candidate.webkitAudioContext ?? null;
}

export interface AudioEngineOptions {
  readonly volume?: number;
  readonly muted?: boolean;
  readonly limits?: SchedulerLimits;
  /** Injectable pour reproduire une session ; le defaut est `Math.random`. */
  readonly random?: () => number;
}

export interface AudioEngine {
  readonly volume: number;
  readonly muted: boolean;
  /** Vrai une fois le contexte cree et demarre. */
  readonly running: boolean;
  play(name: SoundName, options?: SoundOptions): void;
  /** Joue le son qui correspond a un fait de match, s il y en a un. */
  cue(cue: AudioCue): void;
  setVolume(volume: number): void;
  setMuted(muted: boolean): void;
  /** A appeler depuis un geste utilisateur : sans cela, iOS reste muet. */
  resume(): Promise<void>;
  /** A appeler quand l application passe en arriere-plan. */
  suspend(): Promise<void>;
  dispose(): void;
}

/** Duree du tampon de bruit blanc, en secondes. */
const NOISE_BUFFER_SECONDS = 1;

export function createAudioEngine(options: AudioEngineOptions = {}): AudioEngine {
  const mixer: Mixer = createMixer({
    volume: options.volume ?? 1,
    muted: options.muted ?? false,
  });
  const scheduler = createSoundScheduler(options.limits ?? DEFAULT_LIMITS);
  const random = options.random ?? Math.random;

  let context: AudioContext | null = null;
  let master: GainNode | null = null;
  let noiseBuffer: AudioBuffer | null = null;
  let disposed = false;

  const build = (): AudioContext | null => {
    if (context) {
      return context;
    }
    const Ctor = audioContextConstructor();
    if (!Ctor) {
      return null;
    }
    let created: AudioContext;
    try {
      created = new Ctor();
    } catch {
      return null;
    }

    const gain = created.createGain();
    gain.gain.value = mixer.gain;
    const compressor = created.createDynamicsCompressor();
    compressor.threshold.value = COMPRESSOR.threshold;
    compressor.ratio.value = COMPRESSOR.ratio;
    gain.connect(compressor);
    compressor.connect(created.destination);

    const frames = Math.round(created.sampleRate * NOISE_BUFFER_SECONDS);
    const buffer = created.createBuffer(1, frames, created.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < frames; i += 1) {
      data[i] = random() * 2 - 1;
    }

    context = created;
    master = gain;
    noiseBuffer = buffer;
    return created;
  };

  const applyGain = (): void => {
    if (!context || !master) {
      return;
    }
    master.gain.setTargetAtTime(mixer.gain, context.currentTime, GAIN_RAMP_SECONDS);
  };

  const envelope = (ctx: AudioContext, voice: Voice, at: number): GainNode => {
    const gain = ctx.createGain();
    // Rampe exponentielle : l oreille entend le volume en decibels. Elle ne
    // peut pas viser zero, d ou le plancher inaudible aux deux bouts.
    gain.gain.setValueAtTime(ENVELOPE_FLOOR, at);
    gain.gain.exponentialRampToValueAtTime(voice.gain, at + voice.attack);
    gain.gain.exponentialRampToValueAtTime(ENVELOPE_FLOOR, at + voice.duration);
    return gain;
  };

  const playVoice = (ctx: AudioContext, dest: AudioNode, voice: Voice, start: number): void => {
    const at = start + voice.delay;
    const gain = envelope(ctx, voice, at);
    gain.connect(dest);

    if (voice.kind === 'tone') {
      const oscillator = ctx.createOscillator();
      oscillator.type = voice.wave;
      oscillator.frequency.setValueAtTime(voice.from, at);
      if (voice.to !== voice.from) {
        oscillator.frequency.exponentialRampToValueAtTime(voice.to, at + voice.duration);
      }
      oscillator.connect(gain);
      oscillator.onended = (): void => {
        gain.disconnect();
      };
      oscillator.start(at);
      oscillator.stop(at + voice.duration + VOICE_TAIL);
      return;
    }

    if (!noiseBuffer) {
      return;
    }
    const source = ctx.createBufferSource();
    source.buffer = noiseBuffer;
    const filter = ctx.createBiquadFilter();
    filter.type = voice.filter;
    filter.frequency.setValueAtTime(voice.from, at);
    if (voice.to !== voice.from) {
      filter.frequency.exponentialRampToValueAtTime(voice.to, at + voice.duration);
    }
    filter.Q.value = voice.q;
    source.connect(filter);
    filter.connect(gain);
    source.onended = (): void => {
      filter.disconnect();
      gain.disconnect();
    };
    source.start(at, voice.offset, voice.duration + VOICE_TAIL);
  };

  const play = (name: SoundName, playOptions: SoundOptions = {}): void => {
    if (disposed || !context || !master || !mixer.audible) {
      return;
    }
    const scheduled = scheduler.schedule(name, context.currentTime, {
      combo: playOptions.combo ?? 0,
      random: playOptions.random ?? random,
    });
    if (!scheduled) {
      return;
    }
    for (const voice of scheduled.voices) {
      playVoice(context, master, voice, scheduled.at);
    }
  };

  return {
    get volume(): number {
      return mixer.volume;
    },
    get muted(): boolean {
      return mixer.muted;
    },
    get running(): boolean {
      return context?.state === 'running';
    },

    play,

    cue(cue: AudioCue): void {
      const request = soundForCue(cue);
      if (request) {
        play(request.name, { combo: request.combo });
      }
    },

    setVolume(volume: number): void {
      mixer.setVolume(volume);
      applyGain();
    },

    setMuted(muted: boolean): void {
      mixer.setMuted(muted);
      applyGain();
    },

    async resume(): Promise<void> {
      if (disposed) {
        return;
      }
      const ctx = build();
      if (!ctx || ctx.state === 'running') {
        return;
      }
      await ctx.resume();
      // L horloge du contexte a pu bondir pendant la suspension : les sons
      // encore comptes comme actifs ne le sont plus.
      scheduler.reset();
    },

    async suspend(): Promise<void> {
      if (context?.state !== 'running') {
        return;
      }
      await context.suspend();
      scheduler.reset();
    },

    dispose(): void {
      disposed = true;
      scheduler.reset();
      master?.disconnect();
      // `close()` rejette si le contexte est deja ferme : la liberation ne doit
      // pas faire tomber l ecran qui se demonte.
      void context?.close().catch(() => undefined);
      context = null;
      master = null;
      noiseBuffer = null;
    },
  };
}

/** Silence total, pour les tests d interface et les appareils sans Web Audio. */
export function createSilentAudioEngine(): AudioEngine {
  const mixer = createMixer();
  return {
    get volume(): number {
      return mixer.volume;
    },
    get muted(): boolean {
      return mixer.muted;
    },
    running: false,
    play(): void {
      // Rien : un jeu muet doit rester jouable.
    },
    cue(): void {
      // Rien non plus : aucun evenement de match ne s entend.
    },
    setVolume(volume: number): void {
      mixer.setVolume(volume);
    },
    setMuted(muted: boolean): void {
      mixer.setMuted(muted);
    },
    resume(): Promise<void> {
      return Promise.resolve();
    },
    suspend(): Promise<void> {
      return Promise.resolve();
    },
    dispose(): void {
      // Aucune ressource a liberer : rien n a ete alloue.
    },
  };
}
