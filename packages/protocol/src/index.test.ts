import { describe, expect, it } from 'vitest';
import {
  CLIENT_MESSAGE_NAMES,
  ERROR_CODES,
  parseClientMessage,
  PROTOCOL_VERSION,
  SERVER_MESSAGE_NAMES,
} from './index.js';

describe('@aura/protocol — surface publique', () => {
  it('expose la version, les registres et les codes d erreur', () => {
    expect(PROTOCOL_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
    expect(CLIENT_MESSAGE_NAMES.length).toBeGreaterThan(0);
    expect(SERVER_MESSAGE_NAMES.length).toBeGreaterThan(0);
    expect(ERROR_CODES).toContain('CLIENT_OUTDATED');
  });

  it('valide un message depuis la racine du package', () => {
    expect(parseClientMessage('queue:join', { mode: 'ranked' }).success).toBe(true);
  });
});
