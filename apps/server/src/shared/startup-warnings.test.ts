import { describe, expect, it } from 'vitest';
import { startupWarnings } from './startup-warnings.js';

const base = { nodeEnv: 'production' as const, revenuecatWebhookAuth: 'x'.repeat(40) };

describe('startupWarnings', () => {
  /*
    Sans secret, la route de paiement repond 404 et RevenueCat finit par
    abandonner : des ventes perdues sans une ligne dans les journaux.
  */
  it('previent en production quand le webhook de paiement est ferme', () => {
    const warnings = startupWarnings({ ...base, revenuecatWebhookAuth: '' });
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatch(/REVENUECAT_WEBHOOK_AUTH/);
  });

  it('se tait quand tout est pose, et hors production', () => {
    expect(startupWarnings(base)).toEqual([]);
    expect(startupWarnings({ nodeEnv: 'development', revenuecatWebhookAuth: '' })).toEqual([]);
  });
});
