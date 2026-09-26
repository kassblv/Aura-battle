import { chord, detune, noteFrequency } from './notes.js';
import { noise, tone, type Voice } from './voices.js';

/**
 * Table des sons, relevee sur `prototype/aura-battle.html` (« Sons (generes en
 * direct) »).
 *
 * Aucun fichier audio : tout est synthetise. Les hauteurs musicales sont
 * nommees, les frequences purement percussives (graves de choc, coups de
 * gong, souffles) restent en hertz bruts parce qu elles ne sont pas des notes.
 * Les ecarts avec le prototype tiennent aux arrondis de sa notation (il ecrit
 * 660 pour un mi a 659,26 Hz), soit deux centiemes de demi-ton.
 */

export type SoundName =
  | 'click'
  | 'select'
  | 'buy'
  | 'chime'
  | 'gong'
  | 'lock'
  | 'reveal'
  | 'perfect'
  | 'good'
  | 'miss'
  | 'clash'
  | 'counter'
  | 'crowd'
  | 'land'
  | 'victory'
  | 'defeat'
  | 'bip6'
  | 'bip7'
  | 'tap'
  | 'tapGold'
  | 'tapMiss'
  | 'rechargeEnd'
  | 'ultimate'
  | 'whoosh'
  | 'impact'
  | 'hold';

export const SOUND_NAMES: readonly SoundName[] = [
  'click',
  'select',
  'buy',
  'chime',
  'gong',
  'lock',
  'reveal',
  'perfect',
  'good',
  'miss',
  'clash',
  'counter',
  'crowd',
  'land',
  'victory',
  'defeat',
  'bip6',
  'bip7',
  'tap',
  'tapGold',
  'tapMiss',
  'rechargeEnd',
  'ultimate',
  'whoosh',
  'impact',
  'hold',
];

export interface SoundOptions {
  /** Combo courant : il fait monter la hauteur du tap d orbe. */
  readonly combo?: number;
  /**
   * Source de hasard.
   *
   * Par defaut la table est deterministe : les tests n ont rien a simuler, et
   * seul le moteur branche `Math.random`.
   */
  readonly random?: () => number;
}

/** Combo au-dela duquel le tap ne monte plus : sinon il finit en sifflet. */
export const TAP_COMBO_CAP = 16;

const TAP_BASE_FREQUENCY = 520;
const TAP_COMBO_STEP = 0.06;

/** Hauteur d un tap d orbe pour un combo donne. */
export function tapFrequency(combo: number): number {
  const steps = Math.min(Math.max(combo, 0), TAP_COMBO_CAP);
  return TAP_BASE_FREQUENCY * (1 + steps * TAP_COMBO_STEP);
}

/** Etendue du point de lecture tire dans le tampon de bruit. */
const NOISE_OFFSET_SPREAD = 0.4;

/** Construit les voix d un son. Fonction pure : meme entree, memes voix. */
export function voicesFor(name: SoundName, options: SoundOptions = {}): readonly Voice[] {
  const random = options.random ?? (() => 0.5);
  const offset = (): number => random() * NOISE_OFFSET_SPREAD;

  switch (name) {
    case 'click':
      return [
        tone({ wave: 'triangle', from: noteFrequency('A5'), to: 660, duration: 0.06, gain: 0.12 }),
      ];

    case 'select':
      return [tone({ wave: 'triangle', from: 600, to: 900, duration: 0.08, gain: 0.14 })];

    case 'buy':
      return chord('B5', 'E6', 'A6').map((f, i) =>
        tone({ delay: i * 0.07, wave: 'square', from: f, duration: 0.1, gain: 0.07 }),
      );

    case 'chime':
      return [
        tone({ wave: 'sine', from: noteFrequency('G5'), duration: 0.3, gain: 0.15 }),
        tone({ delay: 0.1, wave: 'sine', from: noteFrequency('D6'), duration: 0.45, gain: 0.12 }),
      ];

    case 'gong':
      return [
        tone({ wave: 'sine', from: 150, to: 140, duration: 1.4, gain: 0.35, attack: 0.01 }),
        tone({ wave: 'sine', from: 226, to: 220, duration: 1.1, gain: 0.18, attack: 0.01 }),
        noise({ filter: 'highpass', from: 5000, duration: 0.8, gain: 0.08, offset: offset() }),
      ];

    case 'lock':
      return [
        tone({ wave: 'square', from: 300, to: 600, duration: 0.08, gain: 0.08 }),
        noise({
          from: 600,
          to: 3000,
          q: 0.8,
          duration: 0.28,
          gain: 0.2,
          attack: 0.03,
          offset: offset(),
        }),
      ];

    case 'reveal':
      return [
        tone({ wave: 'sine', from: 160, to: 40, duration: 0.55, gain: 0.7 }),
        noise({
          filter: 'lowpass',
          from: 1200,
          to: 200,
          duration: 0.35,
          gain: 0.35,
          offset: offset(),
        }),
      ];

    case 'perfect':
      return chord('E6', 'B6', 'E7').map((f, i) =>
        tone({ delay: 0.02 + i * 0.05, wave: 'sine', from: f, duration: 0.7, gain: 0.16 }),
      );

    case 'good':
      return [
        tone({
          wave: 'triangle',
          from: noteFrequency('E5'),
          to: noteFrequency('B5'),
          duration: 0.18,
          gain: 0.14,
        }),
      ];

    case 'miss':
      return [tone({ wave: 'square', from: 240, to: 90, duration: 0.4, gain: 0.07 })];

    case 'clash':
      return [
        noise({
          filter: 'lowpass',
          from: 3000,
          to: 300,
          duration: 0.5,
          gain: 0.6,
          offset: offset(),
        }),
        tone({ wave: 'sine', from: noteFrequency('A2'), to: 35, duration: 0.6, gain: 0.8 }),
      ];

    case 'counter':
      return [
        tone({
          wave: 'square',
          from: noteFrequency('D#6'),
          to: detune(noteFrequency('D#6'), -6),
          duration: 0.35,
          gain: 0.1,
        }),
        tone({
          wave: 'square',
          from: noteFrequency('A6'),
          to: detune(noteFrequency('A6'), -10),
          duration: 0.3,
          gain: 0.07,
        }),
        noise({ filter: 'highpass', from: 3000, duration: 0.14, gain: 0.5, offset: offset() }),
        tone({ wave: 'sine', from: 120, to: 35, duration: 0.7, gain: 0.9 }),
      ];

    case 'crowd':
      // Quatre souffles decales, chacun sur une bande differente : c est le
      // desaccord qui donne l impression d une foule plutot que d un seul cri.
      return Array.from({ length: 4 }, (_unused, i) =>
        noise({
          delay: i * 0.05,
          from: 700 + random() * 1500,
          q: 0.7,
          duration: 1.4,
          gain: 0.12,
          attack: 0.25,
          offset: offset(),
        }),
      );

    case 'land':
      return [
        tone({ wave: 'sine', from: 90, to: 50, duration: 0.18, gain: 0.35 }),
        noise({ filter: 'lowpass', from: 500, duration: 0.15, gain: 0.15, offset: offset() }),
      ];

    case 'victory':
      return [
        ...chord('C5', 'E5', 'G5', 'C6').map((f, i) =>
          tone({ delay: i * 0.12, wave: 'square', from: f, duration: 0.22, gain: 0.09 }),
        ),
        tone({
          delay: 0.48,
          wave: 'triangle',
          from: noteFrequency('C6'),
          duration: 0.9,
          gain: 0.14,
        }),
      ];

    case 'defeat':
      // Quatre notes qui descendent en se desaccordant : la fanfare se deregle.
      return chord('G4', 'E4', 'C4', 'G3').map((f, i) =>
        tone({
          delay: i * 0.18,
          wave: 'triangle',
          from: f,
          to: detune(f, -53),
          duration: 0.32,
          gain: 0.16,
        }),
      );

    case 'bip6':
      return [tone({ wave: 'sine', from: 700, duration: 0.07, gain: 0.05 })];

    case 'bip7':
      return [tone({ wave: 'sine', from: 590, duration: 0.07, gain: 0.05 })];

    case 'tap': {
      const f = tapFrequency(options.combo ?? 0);
      return [tone({ wave: 'sine', from: f, to: f * 1.5, duration: 0.09, gain: 0.13 })];
    }

    case 'tapGold':
      return chord('B5', 'F#6').map((f, i) =>
        tone({ delay: i * 0.04, wave: 'triangle', from: f, duration: 0.18, gain: 0.12 }),
      );

    case 'tapMiss':
      return [
        noise({ filter: 'lowpass', from: 400, duration: 0.06, gain: 0.12, offset: offset() }),
      ];

    case 'rechargeEnd':
      return chord('E5', 'G5', 'B5', 'E6').map((f, i) =>
        tone({ delay: i * 0.07, wave: 'triangle', from: f, duration: 0.25, gain: 0.1 }),
      );

    case 'ultimate':
      return [
        tone({ wave: 'sawtooth', from: 180, to: 1400, duration: 0.6, gain: 0.1 }),
        noise({
          from: 300,
          to: 4000,
          q: 1,
          duration: 0.6,
          gain: 0.25,
          attack: 0.4,
          offset: offset(),
        }),
        ...chord('C5', 'E5', 'G5', 'C6').map((f) =>
          tone({ delay: 0.55, wave: 'triangle', from: f, duration: 1.1, gain: 0.09 }),
        ),
        tone({ delay: 0.55, wave: 'sine', from: 80, to: 40, duration: 0.8, gain: 0.8 }),
      ];

    /**
     * Les trois accents de geste (`sound` dans une animation).
     *
     * Ils disent ce que le CORPS fait, pas ce que le joueur a choisi ni s il a
     * reussi : c est ce qui les rend jouables des deux cotes de l arene sans
     * rien trahir. Voir la note de `cues.ts` sur la regle d or n°4.
     */

    case 'whoosh':
      // Un membre qui fend l air : une bande qui gonfle puis tombe. L attaque
      // longue fait tout le travail — une attaque courte donnerait un « tss »
      // de cymbale au lieu du passage d un bras.
      return [
        noise({
          from: 2400,
          to: 380,
          q: 1.2,
          duration: 0.34,
          gain: 0.22,
          attack: 0.14,
          offset: offset(),
        }),
        noise({
          delay: 0.04,
          filter: 'highpass',
          from: 1800,
          to: 900,
          duration: 0.22,
          gain: 0.07,
          attack: 0.1,
          offset: offset(),
        }),
      ];

    case 'impact':
      // Un contact sec : une main qui claque, un corps qui retombe de sa roue.
      // Plus mordant que `land`, qui n est qu un poids qui se repose, et bien
      // plus court que `clash`, qui doit tenir toute une revelation.
      return [
        tone({ wave: 'sine', from: 170, to: 48, duration: 0.24, gain: 0.5 }),
        noise({
          filter: 'lowpass',
          from: 1400,
          to: 250,
          duration: 0.14,
          gain: 0.3,
          offset: offset(),
        }),
        noise({ filter: 'highpass', from: 4200, duration: 0.05, gain: 0.22, offset: offset() }),
      ];

    case 'hold':
      // Le souffle d une pose tenue. Il gonfle au lieu de frapper : c est une
      // pose qu il accompagne, et une attaque nette la transformerait en coup.
      return [
        tone({
          wave: 'sine',
          from: noteFrequency('A3'),
          duration: 1.1,
          gain: 0.1,
          attack: 0.45,
        }),
        tone({
          delay: 0.06,
          wave: 'triangle',
          from: noteFrequency('E4'),
          duration: 1,
          gain: 0.06,
          attack: 0.5,
        }),
        noise({
          from: 500,
          to: 1500,
          q: 0.8,
          duration: 1.1,
          gain: 0.09,
          attack: 0.6,
          offset: offset(),
        }),
      ];
  }
}
