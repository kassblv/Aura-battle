import { describe, expect, it } from 'vitest';
import { MASTER_GAIN, clampVolume, createMixer, gainOf } from './mixer.js';

describe('clampVolume', () => {
  it('laisse passer un volume valide', () => {
    expect(clampVolume(0.4)).toBe(0.4);
    expect(clampVolume(0)).toBe(0);
    expect(clampVolume(1)).toBe(1);
  });

  it('ramene un curseur qui deborde', () => {
    expect(clampVolume(1.8)).toBe(1);
    expect(clampVolume(-0.5)).toBe(0);
  });

  // Un NaN pousse dans un GainNode leve une exception et tue le son pour le
  // reste de la partie : il arrive vite d un reglage relu sur le disque.
  it('transforme une valeur invalide en silence, pas en exception', () => {
    expect(clampVolume(Number.NaN)).toBe(0);
    expect(clampVolume(Number.POSITIVE_INFINITY)).toBe(0);
    expect(clampVolume(Number.NEGATIVE_INFINITY)).toBe(0);
  });
});

describe('gainOf', () => {
  it('applique la reserve de niveau du prototype', () => {
    expect(gainOf({ volume: 1, muted: false })).toBe(MASTER_GAIN);
    expect(MASTER_GAIN).toBeLessThan(1);
  });

  it('coupe tout quand le son est coupe', () => {
    expect(gainOf({ volume: 1, muted: true })).toBe(0);
  });

  it('borne le volume avant de le convertir en niveau', () => {
    expect(gainOf({ volume: 12, muted: false })).toBe(MASTER_GAIN);
  });
});

describe('createMixer', () => {
  it('demarre a plein volume, son actif', () => {
    const mixer = createMixer();
    expect(mixer.volume).toBe(1);
    expect(mixer.muted).toBe(false);
    expect(mixer.audible).toBe(true);
  });

  it('borne le volume initial comme les suivants', () => {
    expect(createMixer({ volume: 4 }).volume).toBe(1);
    expect(createMixer({ volume: -1 }).volume).toBe(0);
  });

  // Couper puis retablir doit rendre le volume exact d avant : sinon chaque
  // aller-retour dans les reglages deplace le curseur.
  it('retrouve son volume apres une coupure', () => {
    const mixer = createMixer({ volume: 0.3 });
    mixer.setMuted(true);
    expect(mixer.gain).toBe(0);
    expect(mixer.volume).toBe(0.3);
    mixer.setMuted(false);
    expect(mixer.gain).toBeCloseTo(0.3 * MASTER_GAIN, 6);
  });

  it('se declare inaudible a volume zero comme en coupure', () => {
    const mixer = createMixer();
    mixer.setVolume(0);
    expect(mixer.audible).toBe(false);
    mixer.setVolume(0.5);
    expect(mixer.audible).toBe(true);
    mixer.setMuted(true);
    expect(mixer.audible).toBe(false);
  });
});
