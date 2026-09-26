import { describe, expect, it } from 'vitest';
import { INVENTORY_FAILURES } from '../net/inventory.js';
import { INVENTORY_MESSAGES } from './useInventory.js';

describe('messages de l inventaire', () => {
  /*
    Chaque refus que le serveur sait nommer a sa phrase. Un code sans phrase
    retombe sur « Impossible pour le moment. » — vrai, mais inutile au joueur.
  */
  it('a une phrase pour chaque refus nomme par le serveur', () => {
    for (const code of INVENTORY_FAILURES) {
      expect(INVENTORY_MESSAGES[code], code).toBeTruthy();
    }
  });

  it('dit d attendre quand le serveur limite le debit', () => {
    expect(INVENTORY_MESSAGES.RATE_LIMITED).toMatch(/instant|seconde/);
  });
});
