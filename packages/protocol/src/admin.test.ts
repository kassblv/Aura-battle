import { describe, expect, it } from 'vitest';
import {
  adminBanRequestSchema,
  adminEventOverrideRequestSchema,
  adminFlagUpdateRequestSchema,
  adminPlayerSearchQuerySchema,
  weekEventSchema,
} from './index.js';

/*
  Contrat du panneau d'administration (ADR 0018). Chaque ecriture est bornee et
  stricte : le panneau est la porte la plus interessante du systeme, un champ
  de trop n'y passe pas.
*/
describe('drapeaux', () => {
  it('coupe, rallume, ou ouvre une nouvelle mesure a une part bornee', () => {
    expect(adminFlagUpdateRequestSchema.safeParse({ action: 'pause' }).success).toBe(true);
    expect(adminFlagUpdateRequestSchema.safeParse({ action: 'resume' }).success).toBe(true);
    expect(
      adminFlagUpdateRequestSchema.safeParse({ action: 'new-measure', rollout: 30 }).success,
    ).toBe(true);
  });

  it('refuse une part hors de 1 a 100 pour une mesure (0, c est couper)', () => {
    for (const rollout of [0, 101, 12.5, -1]) {
      expect(
        adminFlagUpdateRequestSchema.safeParse({ action: 'new-measure', rollout }).success,
      ).toBe(false);
    }
  });

  it('refuse de regler la part sans ouvrir de mesure', () => {
    expect(adminFlagUpdateRequestSchema.safeParse({ action: 'resume', rollout: 80 }).success).toBe(
      false,
    );
  });
});

describe('evenement de la semaine', () => {
  it('force une variante, la normale, ou revient a la rotation', () => {
    for (const variant of ['ultime', 'normal', null]) {
      expect(adminEventOverrideRequestSchema.safeParse({ variant }).success).toBe(true);
    }
  });

  it('refuse un identifiant mal forme', () => {
    expect(adminEventOverrideRequestSchema.safeParse({ variant: 'Ultime!' }).success).toBe(false);
  });

  it('decrit une semaine publique sans rien de plus', () => {
    const week = { week: 2910, variant: 'ultime', endsAt: '2026-09-28T00:00:00.000Z' };
    expect(weekEventSchema.safeParse(week).success).toBe(true);
    expect(weekEventSchema.safeParse({ ...week, source: 'override' }).success).toBe(false);
  });
});

describe('joueurs', () => {
  it('borne la recherche', () => {
    expect(adminPlayerSearchQuerySchema.safeParse({ q: 'Kas' }).success).toBe(true);
    expect(adminPlayerSearchQuerySchema.safeParse({ q: '' }).success).toBe(false);
    expect(adminPlayerSearchQuerySchema.safeParse({ q: 'x'.repeat(65) }).success).toBe(false);
  });

  it('bannit jusqu a une date ou definitivement, jamais sans motif', () => {
    expect(
      adminBanRequestSchema.safeParse({ until: '2026-10-01T00:00:00.000Z', reason: 'triche' })
        .success,
    ).toBe(true);
    expect(adminBanRequestSchema.safeParse({ until: null, reason: 'triche avérée' }).success).toBe(
      true,
    );
    expect(adminBanRequestSchema.safeParse({ until: null, reason: '' }).success).toBe(false);
    expect(adminBanRequestSchema.safeParse({ until: 'demain', reason: 'triche' }).success).toBe(
      false,
    );
  });
});

/*
  Un joueur banni depuis le panneau doit l'apprendre comme tel — pas comme un
  jeton perime, qui ferait reessayer le client en boucle.
*/
describe('bannissement', () => {
  it('a son code, sur le socket comme en HTTP', async () => {
    const { ERROR_CODES, AUTH_ERROR_CODES } = await import('./index.js');
    expect(ERROR_CODES).toContain('BANNED');
    expect(AUTH_ERROR_CODES).toContain('BANNED');
  });
});
