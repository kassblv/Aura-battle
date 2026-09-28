import { describe, expect, it } from 'vitest';
import { ENVELOPE_FLOOR, VOICE_TAIL, noise, soundDuration, tone, voiceEnd } from './voices.js';

describe('tone', () => {
  it('ne fait pas glisser une note dont la cible est omise', () => {
    const voice = tone({ wave: 'sine', from: 440, duration: 0.2, gain: 0.1 });
    expect(voice.to).toBe(440);
  });

  it('pose une attaque par defaut, courte mais non nulle', () => {
    // Une attaque nulle ferait un clic, et une rampe exponentielle de duree
    // nulle est refusee par la Web Audio API.
    const voice = tone({ wave: 'sine', from: 440, duration: 0.2, gain: 0.1 });
    expect(voice.attack).toBeGreaterThan(0);
  });

  it('garde le retard demande pour les arpeges', () => {
    expect(tone({ delay: 0.12, wave: 'square', from: 440, duration: 0.2, gain: 0.1 }).delay).toBe(
      0.12,
    );
  });
});

describe('noise', () => {
  it('filtre en bande passante par defaut', () => {
    expect(noise({ from: 1000, duration: 0.1, gain: 0.2 }).filter).toBe('bandpass');
  });

  it('reste a frequence fixe quand aucune cible n est donnee', () => {
    const voice = noise({ from: 1000, duration: 0.1, gain: 0.2 });
    expect(voice.to).toBe(1000);
    expect(voice.offset).toBe(0);
  });
});

describe('voiceEnd', () => {
  it('compte le retard, la duree et la queue', () => {
    const voice = tone({ delay: 0.1, wave: 'sine', from: 440, duration: 0.3, gain: 0.1 });
    expect(voiceEnd(voice)).toBeCloseTo(0.4 + VOICE_TAIL, 6);
  });
});

describe('soundDuration', () => {
  it('suit la voix qui finit le plus tard, pas la derniere declaree', () => {
    const voices = [
      tone({ delay: 0.5, wave: 'sine', from: 440, duration: 0.1, gain: 0.1 }),
      tone({ wave: 'sine', from: 220, duration: 1.2, gain: 0.1 }),
    ];
    expect(soundDuration(voices)).toBeCloseTo(1.2 + VOICE_TAIL, 6);
  });

  it('rend zero pour un son vide', () => {
    expect(soundDuration([])).toBe(0);
  });
});

describe('ENVELOPE_FLOOR', () => {
  it('reste strictement positif', () => {
    // Zero est refuse par exponentialRampToValueAtTime : le plancher doit etre
    // inaudible, pas nul.
    expect(ENVELOPE_FLOOR).toBeGreaterThan(0);
    expect(ENVELOPE_FLOOR).toBeLessThan(0.001);
  });
});
