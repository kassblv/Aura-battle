import { describe, expect, it } from 'vitest';
import { CredentialsEvents } from './credentials-events.js';

describe('CredentialsEvents', () => {
  it('previent chaque abonne, meme si un autre leve', () => {
    const events = new CredentialsEvents();
    const seen: string[] = [];
    events.subscribe(() => {
      throw new Error('socket deja fermee');
    });
    events.subscribe((playerId) => seen.push(playerId));
    events.publish('p1');
    expect(seen).toEqual(['p1']);
  });
});
