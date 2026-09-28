import { describe, expect, it } from 'vitest';
import { A4_FREQUENCY, chord, detune, noteFrequency, transpose } from './notes.js';

describe('noteFrequency', () => {
  it('accorde le la du diapason', () => {
    expect(noteFrequency('A4')).toBe(A4_FREQUENCY);
  });

  it('double a chaque octave', () => {
    expect(noteFrequency('A5')).toBeCloseTo(880, 6);
    expect(noteFrequency('A3')).toBeCloseTo(220, 6);
  });

  // Convention MIDI : l octave change au do, pas au la. Si elle changeait au
  // la, C5 tomberait une octave trop bas et toute la table sonnerait faux.
  it("fait changer l'octave au do", () => {
    expect(noteFrequency('C5')).toBeCloseTo(523.25, 2);
    expect(noteFrequency('B4')).toBeCloseTo(493.88, 2);
    expect(noteFrequency('C5') / noteFrequency('B4')).toBeGreaterThan(1);
  });

  it('lit les alterations dans les deux sens', () => {
    expect(noteFrequency('A#4')).toBeCloseTo(noteFrequency('Bb4'), 6);
    expect(noteFrequency('C#5')).toBeCloseTo(554.37, 2);
    expect(noteFrequency('Eb6')).toBeCloseTo(1244.51, 2);
  });

  // Les hertz ecrits dans le prototype sont ces notes, arrondies a l unite.
  it('retrouve les frequences du prototype', () => {
    const relevees: Record<string, number> = {
      C4: 262,
      G3: 196,
      E4: 330,
      G4: 392,
      C5: 523,
      E5: 659,
      G5: 784,
      B5: 988,
      C6: 1047,
      D6: 1175,
      E6: 1319,
      'F#6': 1480,
      A6: 1760,
      B6: 1976,
      E7: 2637,
    };
    for (const [note, hertz] of Object.entries(relevees)) {
      expect(Math.round(noteFrequency(note))).toBe(hertz);
    }
  });

  it('refuse ce qui n est pas une note', () => {
    expect(() => noteFrequency('H4')).toThrow(/Note attendue/);
    expect(() => noteFrequency('A')).toThrow(/Note attendue/);
    expect(() => noteFrequency('')).toThrow(/Note attendue/);
    expect(() => noteFrequency('a4')).toThrow(/Note attendue/);
  });
});

describe('chord', () => {
  it('rend les notes dans l ordre donne', () => {
    expect(chord('C5', 'E5', 'G5')).toEqual([
      noteFrequency('C5'),
      noteFrequency('E5'),
      noteFrequency('G5'),
    ]);
  });
});

describe('transpose', () => {
  it('monte de douze demi-tons pour une octave', () => {
    expect(transpose(440, 12)).toBeCloseTo(880, 6);
    expect(transpose(440, -12)).toBeCloseTo(220, 6);
  });

  it('ne bouge pas a zero demi-ton', () => {
    expect(transpose(523.25, 0)).toBe(523.25);
  });
});

describe('detune', () => {
  // Le prototype fait glisser ses notes de defaite vers f * .97.
  it('traduit le glissement de defaite du prototype', () => {
    expect(detune(392, -53)).toBeCloseTo(392 * 0.97, 0);
  });

  it('vaut une transposition a cent centiemes par demi-ton', () => {
    expect(detune(440, 100)).toBeCloseTo(transpose(440, 1), 6);
  });
});
