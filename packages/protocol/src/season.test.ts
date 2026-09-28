import { describe, expect, it } from 'vitest';
import { parseSeasonClaimRequest, seasonStateSchema } from './season.js';

describe('passe de saison — protocole', () => {
  it('accepte une reclamation d un palier sur une piste', () => {
    expect(parseSeasonClaimRequest({ tier: 12, track: 'premium' }).success).toBe(true);
  });

  // Le client dit QUEL palier il reclame, jamais ce qu'il y gagne.
  it('refuse tout montant, un palier hors bornes et une piste inconnue', () => {
    expect(parseSeasonClaimRequest({ tier: 1, track: 'free', amount: 999 }).success).toBe(false);
    expect(parseSeasonClaimRequest({ tier: 0, track: 'free' }).success).toBe(false);
    expect(parseSeasonClaimRequest({ tier: 31, track: 'free' }).success).toBe(false);
    expect(parseSeasonClaimRequest({ tier: 1.5, track: 'free' }).success).toBe(false);
    expect(parseSeasonClaimRequest({ tier: 1, track: 'gold' }).success).toBe(false);
  });

  it('decrit l etat de la saison, bourse comprise', () => {
    const state = {
      season: { number: 1, endsAt: '2026-10-27T00:00:00.000Z' },
      xp: 250,
      tier: 2,
      premium: false,
      claimed: [{ tier: 1, track: 'free' }],
      wallet: { soft: 40, hard: 0 },
    };
    expect(seasonStateSchema.safeParse(state).success).toBe(true);
    expect(seasonStateSchema.safeParse({ ...state, extra: 1 }).success).toBe(false);
  });

  it('dit qu il n y a pas de saison en cours', () => {
    expect(
      seasonStateSchema.safeParse({
        season: null,
        xp: 0,
        tier: 0,
        premium: false,
        claimed: [],
        wallet: { soft: 0, hard: 0 },
      }).success,
    ).toBe(true);
  });
});
