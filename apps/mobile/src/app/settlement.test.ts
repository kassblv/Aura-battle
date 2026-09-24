import { SERVER_MESSAGES, type ServerMessage } from '@aura/protocol';
import { describe, expect, it } from 'vitest';

import { settlementOf } from './settlement.js';

/** Un `match:end` tel que le serveur l'envoie, passe par le vrai schema. */
function matchEnd(coins: number, xpTotal = 18): ServerMessage<'match:end'> {
  return SERVER_MESSAGES['match:end'].parse({
    matchId: '0f8fad5b-d9cb-469f-a165-70867728950e',
    winner: null,
    reason: 'rounds',
    rating: { before: 0, after: 0, leagueBefore: 'unranked', leagueAfter: 'unranked' },
    rewards: { softCurrency: coins, xp: 18, xpTotal },
  });
}

describe('settlementOf', () => {
  it('fait relire la bourse quand le match a rapporte des pieces', () => {
    // La regression : « +12 ◈ » a l'ecran de fin, 12 en base, 0 a l'accueil.
    expect(settlementOf(matchEnd(12), null).rereadWallet).toBe(true);
  });

  it('ne relit rien quand le match n a rien rapporte', () => {
    expect(settlementOf(matchEnd(0), 'moi').rereadWallet).toBe(false);
  });

  it('recopie l experience TOTALE, pas le gain', () => {
    expect(settlementOf(matchEnd(12, 240), 'moi').outcome.xp).toBe(240);
  });

  it('garde une egalite comme egalite, pas comme defaite', () => {
    expect(settlementOf(matchEnd(12), null).outcome.won).toBeNull();
    expect(settlementOf(matchEnd(12), 'moi').outcome.won).toBe(true);
    expect(settlementOf(matchEnd(12), 'adversaire').outcome.won).toBe(false);
  });

  it('reprend la ligue annoncee apres le match', () => {
    expect(settlementOf(matchEnd(12), 'moi').league).toBe('unranked');
  });
});
