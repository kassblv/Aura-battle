/**
 * Hauteurs musicales.
 *
 * Le prototype ecrit ses sons en hertz bruts (523, 659, 784...) : ce sont des
 * notes arrondies. Les nommer rend la table de sons relisible et permet de
 * transposer une fanfare sans recalculer chaque frequence a la main.
 */

/** Diapason. Tout le reste en decoule. */
export const A4_FREQUENCY = 440;

/** Numero MIDI du la du diapason. */
export const A4_MIDI = 69;

const SEMITONES_PER_OCTAVE = 12;
const CENTS_PER_OCTAVE = 1200;

/** Demi-tons de chaque note naturelle au-dessus du do. */
const NATURAL_SEMITONES: Readonly<Record<string, number>> = {
  C: 0,
  D: 2,
  E: 4,
  F: 5,
  G: 7,
  A: 9,
  B: 11,
};

const NOTE_RE = /^([A-G])([#b]?)(-?\d{1,2})$/;

/**
 * Traduit une note (`C4`, `F#5`, `Eb3`) en hertz.
 *
 * Convention MIDI : `C4` vaut 60, donc l octave change au do, pas au la.
 */
export function noteFrequency(note: string): number {
  const match = NOTE_RE.exec(note);
  const letter = match?.[1];
  const base = letter === undefined ? undefined : NATURAL_SEMITONES[letter];
  const octave = match?.[3];
  if (base === undefined || octave === undefined) {
    throw new Error(`Note attendue sous la forme C4, F#5 ou Eb3 : ${note}`);
  }
  const accidental = match?.[2] === '#' ? 1 : match?.[2] === 'b' ? -1 : 0;
  const midi = (Number(octave) + 1) * SEMITONES_PER_OCTAVE + base + accidental;
  return A4_FREQUENCY * 2 ** ((midi - A4_MIDI) / SEMITONES_PER_OCTAVE);
}

/** Raccourci pour les accords, ecrits du grave a l aigu. */
export function chord(...notes: readonly string[]): readonly number[] {
  return notes.map(noteFrequency);
}

/** Deplace une frequence de `semitones` demi-tons, dans un sens ou dans l autre. */
export function transpose(frequency: number, semitones: number): number {
  return frequency * 2 ** (semitones / SEMITONES_PER_OCTAVE);
}

/**
 * Desaccorde d un centieme de demi-ton pres.
 *
 * Le prototype fait glisser certaines notes vers `f * .97` pour donner l air
 * defait : c est un detune, pas un intervalle.
 */
export function detune(frequency: number, cents: number): number {
  return frequency * 2 ** (cents / CENTS_PER_OCTAVE);
}
