import { describe, expect, it } from 'vitest';
import { resolveServerUrl } from './serverUrl.js';

describe('resolveServerUrl', () => {
  it('garde une URL distante telle quelle', () => {
    expect(resolveServerUrl('https://api.aura.example', '192.168.1.20')).toBe(
      'https://api.aura.example',
    );
  });

  it('reecrit localhost quand la page est servie sur le reseau local', () => {
    expect(resolveServerUrl('http://localhost:3000', '192.168.1.20')).toBe(
      'http://192.168.1.20:3000',
    );
  });

  it('laisse localhost tranquille quand on developpe sur le Mac', () => {
    expect(resolveServerUrl('http://localhost:3000', 'localhost')).toBe('http://localhost:3000');
  });

  it('retombe sur l hote de la page quand rien n est configure', () => {
    expect(resolveServerUrl(undefined, '192.168.1.20')).toBe('http://192.168.1.20:3000');
  });

  it('refuse une URL invalide', () => {
    expect(() => resolveServerUrl('pas-une-url', 'localhost')).toThrow(/VITE_SERVER_URL/);
  });
});
