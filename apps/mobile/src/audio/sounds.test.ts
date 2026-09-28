import { describe, expect, it } from 'vitest';
import { SOUND_NAMES, TAP_COMBO_CAP, tapFrequency, voicesFor } from './sounds.js';
import { ENVELOPE_FLOOR, soundDuration, type Voice } from './voices.js';

const everySound = (): readonly (readonly [string, readonly Voice[]])[] =>
  SOUND_NAMES.map((name) => [name, voicesFor(name)] as const);

describe('voicesFor', () => {
  it('donne au moins une voix a chaque son connu', () => {
    for (const [name, voices] of everySound()) {
      expect(voices.length, name).toBeGreaterThan(0);
    }
  });

  // Une enveloppe qui culmine sous son plancher descend au lieu de monter :
  // le son existe dans le graphe et n est jamais audible.
  it('culmine toujours au-dessus du plancher des enveloppes', () => {
    for (const [name, voices] of everySound()) {
      for (const voice of voices) {
        expect(voice.gain, name).toBeGreaterThan(ENVELOPE_FLOOR);
        expect(voice.gain, name).toBeLessThanOrEqual(1);
      }
    }
  });

  // Les rampes exponentielles de la Web Audio API refusent zero, et une
  // frequence negative n a pas de sens pour un filtre.
  it('garde toutes les frequences strictement positives', () => {
    for (const [name, voices] of everySound()) {
      for (const voice of voices) {
        expect(voice.from, name).toBeGreaterThan(0);
        expect(voice.to, name).toBeGreaterThan(0);
      }
    }
  });

  it('donne une attaque plus courte que la voix elle-meme', () => {
    for (const [name, voices] of everySound()) {
      for (const voice of voices) {
        expect(voice.attack, name).toBeGreaterThan(0);
        expect(voice.attack, name).toBeLessThan(voice.duration);
      }
    }
  });

  it('tient dans une seconde et demie, sauf les sons de fin de manche', () => {
    const longs = new Set(['gong', 'victory', 'defeat', 'crowd', 'ultimate']);
    for (const [name, voices] of everySound()) {
      if (!longs.has(name)) {
        expect(soundDuration(voices), name).toBeLessThan(1.5);
      }
    }
  });

  it('est pure : deux appels identiques donnent les memes voix', () => {
    expect(voicesFor('victory')).toEqual(voicesFor('victory'));
    expect(voicesFor('tap', { combo: 7 })).toEqual(voicesFor('tap', { combo: 7 }));
  });

  it('ne tire au sort que par la source de hasard fournie', () => {
    const fixe = voicesFor('crowd', { random: () => 0.25 });
    const autre = voicesFor('crowd', { random: () => 0.75 });
    expect(fixe).not.toEqual(autre);
    expect(fixe).toEqual(voicesFor('crowd', { random: () => 0.25 }));
  });

  it('decale les souffles de foule pour eviter le cri unique', () => {
    const voices = voicesFor('crowd');
    const delays = voices.map((voice) => voice.delay);
    expect(new Set(delays).size).toBe(voices.length);
  });

  it('empile les notes d un accord en arpege', () => {
    const delays = voicesFor('victory').map((voice) => voice.delay);
    expect(delays).toEqual([...delays].sort((a, b) => a - b));
    expect(new Set(delays).size).toBeGreaterThan(1);
  });

  it('distingue la fanfare de victoire de celle de defaite', () => {
    expect(voicesFor('victory')).not.toEqual(voicesFor('defeat'));
  });

  // Le prototype fait descendre la defaite et monter la victoire : c est ce
  // contour qui porte l information, pas le timbre.
  it('fait descendre la defaite et monter la victoire', () => {
    const monte = (voices: readonly Voice[]): boolean =>
      voices.slice(1).every((voice, i) => voice.from >= (voices[i]?.from ?? 0));
    const victoire = voicesFor('victory').filter((voice) => voice.delay < 0.48);
    expect(monte(victoire)).toBe(true);
    expect(monte(voicesFor('defeat'))).toBe(false);
  });

  it('donne au tap dore un timbre distinct du tap ordinaire', () => {
    expect(voicesFor('tapGold')).not.toEqual(voicesFor('tap'));
  });

  it('mele du bruit au grave pour le choc et le contre', () => {
    for (const name of ['clash', 'counter'] as const) {
      const voices = voicesFor(name);
      expect(
        voices.some((voice) => voice.kind === 'noise'),
        name,
      ).toBe(true);
      expect(
        voices.some((voice) => voice.kind === 'tone' && voice.from < 200),
        name,
      ).toBe(true);
    }
  });

  it('frappe plus fort sur un contre que sur un choc ordinaire', () => {
    const force = (name: 'clash' | 'counter'): number =>
      voicesFor(name).reduce((total, voice) => total + voice.gain, 0);
    expect(force('counter')).toBeGreaterThan(force('clash'));
  });

  it('place la retombee de l Ultime apres sa montee', () => {
    const voices = voicesFor('ultimate');
    const montee = voices.find((voice) => voice.kind === 'tone' && voice.wave === 'sawtooth');
    expect(montee?.delay).toBe(0);
    expect(voices.some((voice) => voice.delay > 0.5)).toBe(true);
  });
});

describe('tapFrequency', () => {
  it('part de la hauteur de base sans combo', () => {
    expect(tapFrequency(0)).toBeCloseTo(520, 6);
  });

  it('monte avec le combo', () => {
    expect(tapFrequency(5)).toBeGreaterThan(tapFrequency(0));
    expect(tapFrequency(12)).toBeGreaterThan(tapFrequency(5));
  });

  // Sans plafond, une rafale de cinquante orbes finit en sifflet inaudible.
  it('plafonne : le tap ne part pas dans les ultrasons', () => {
    expect(tapFrequency(TAP_COMBO_CAP)).toBe(tapFrequency(TAP_COMBO_CAP + 1));
    expect(tapFrequency(1000)).toBe(tapFrequency(TAP_COMBO_CAP));
    expect(tapFrequency(TAP_COMBO_CAP)).toBeLessThan(1200);
  });

  it('ignore un combo negatif plutot que de descendre', () => {
    expect(tapFrequency(-3)).toBe(tapFrequency(0));
  });

  it('transporte le combo jusqu aux voix du tap', () => {
    const grave = voicesFor('tap', { combo: 0 });
    const aigu = voicesFor('tap', { combo: 10 });
    expect(aigu[0]?.from).toBeGreaterThan(grave[0]?.from ?? 0);
  });
});
