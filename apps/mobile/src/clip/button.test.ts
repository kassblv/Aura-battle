import { describe, expect, it } from 'vitest';
import { clipButton } from './button.js';

describe('clipButton', () => {
  it('n existe pas sans clip', () => {
    expect(clipButton('none', 'idle')).toBeNull();
  });

  it('dit que le clip se prepare tant qu il s encode', () => {
    for (const status of ['recording', 'encoding'] as const) {
      expect(clipButton(status, 'idle')).toEqual({
        label: 'Préparation…',
        disabled: true,
        tone: 'busy',
      });
    }
  });

  it('propose le partage quand le clip est pret, et apres une annulation', () => {
    expect(clipButton('ready', 'idle')?.label).toBe('🎬 Partager le clip');
    expect(clipButton('ready', 'cancelled')?.label).toBe('🎬 Partager le clip');
  });

  it('ne se touche pas deux fois pendant le partage', () => {
    expect(clipButton('ready', 'sharing')?.disabled).toBe(true);
  });

  it('dit le resultat, succes, telechargement ou echec', () => {
    expect(clipButton('ready', 'shared')).toMatchObject({ label: '✓ Clip partagé', tone: 'done' });
    expect(clipButton('ready', 'downloaded')).toMatchObject({
      label: '✓ Clip téléchargé',
      tone: 'done',
    });
    expect(clipButton('ready', 'failed')).toMatchObject({
      label: 'Partage impossible',
      tone: 'error',
      disabled: false,
    });
  });
});
