import { describe, expect, it } from 'vitest';
import { isCompatibleProtocol, majorOf, PROTOCOL_VERSION } from './version.js';

describe('PROTOCOL_VERSION', () => {
  it('est un semver', () => {
    expect(PROTOCOL_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it('est en 2.5.0 : la mesure du partage de clip', () => {
    expect(PROTOCOL_VERSION).toBe('2.5.0');
  });
});

describe('majorOf', () => {
  it('extrait la version majeure', () => {
    expect(majorOf('2.4.1')).toBe(2);
    expect(majorOf('10.0.0')).toBe(10);
  });

  it('rend null sur une chaine qui n est pas un semver', () => {
    expect(majorOf('pas-une-version')).toBe(null);
    expect(majorOf('')).toBe(null);
  });
});

describe('isCompatibleProtocol', () => {
  it('accepte la meme version majeure', () => {
    expect(isCompatibleProtocol(PROTOCOL_VERSION)).toBe(true);
    expect(isCompatibleProtocol('2.9.3')).toBe(true);
  });

  it('refuse une version majeure differente', () => {
    // Un client 1.x enverrait `move`, que le serveur refuse desormais.
    expect(isCompatibleProtocol('1.3.0')).toBe(false);
    expect(isCompatibleProtocol('3.0.0')).toBe(false);
    expect(isCompatibleProtocol('0.9.0')).toBe(false);
  });

  it('refuse une version illisible', () => {
    expect(isCompatibleProtocol('latest')).toBe(false);
  });
});
