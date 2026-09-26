import { describe, expect, it } from 'vitest';
import { ADMIN_FAILURE_LIMIT, ADMIN_FAILURE_WINDOW_MS, AdminGate } from './admin-gate.js';

const SECRET = 'secret-d-administration-assez-long';

function build(token = SECRET) {
  let now = Date.UTC(2026, 8, 26, 12);
  let secret = token;
  const gate = new AdminGate({ token: () => secret, now: () => now });
  return {
    gate,
    advance: (ms: number) => (now += ms),
    setSecret: (value: string) => (secret = value),
  };
}

describe('AdminGate', () => {
  it('le panneau n existe pas sans secret configure, quoi qu on presente', () => {
    const { gate } = build('');
    expect(gate.check(`Bearer ${SECRET}`, '1.2.3.4')).toBe('DISABLED');
    expect(gate.check('Bearer ', '1.2.3.4')).toBe('DISABLED');
    expect(gate.check(undefined, '1.2.3.4')).toBe('DISABLED');
  });

  it('laisse passer le bon secret, refuse les autres', () => {
    const { gate } = build();
    expect(gate.check(`Bearer ${SECRET}`, '1.2.3.4')).toBe('OK');
    expect(gate.check(undefined, '1.2.3.4')).toBe('UNAUTHORIZED');
    expect(gate.check('Bearer mauvais', '1.2.3.4')).toBe('UNAUTHORIZED');
    expect(gate.check(SECRET, '1.2.3.4')).toBe('UNAUTHORIZED');
    expect(gate.check(`bearer ${SECRET}`, '1.2.3.4')).toBe('UNAUTHORIZED');
  });

  it(`au-dela de ${String(ADMIN_FAILURE_LIMIT)} echecs par minute, l adresse est refusee meme avec le bon secret`, () => {
    const { gate, advance } = build();
    for (let i = 0; i < ADMIN_FAILURE_LIMIT; i += 1) {
      expect(gate.check('Bearer mauvais', '9.9.9.9')).toBe('UNAUTHORIZED');
    }
    expect(gate.check('Bearer mauvais', '9.9.9.9')).toBe('RATE_LIMITED');
    // Le bon secret ne rouvre pas la porte : sinon la limite ne limiterait rien.
    expect(gate.check(`Bearer ${SECRET}`, '9.9.9.9')).toBe('RATE_LIMITED');
    // Une autre adresse n'est pas concernee.
    expect(gate.check(`Bearer ${SECRET}`, '8.8.8.8')).toBe('OK');
    // La fenetre passee, tout reprend.
    advance(ADMIN_FAILURE_WINDOW_MS);
    expect(gate.check(`Bearer ${SECRET}`, '9.9.9.9')).toBe('OK');
  });

  it('les appels reussis ne comptent pas', () => {
    const { gate } = build();
    for (let i = 0; i < ADMIN_FAILURE_LIMIT * 5; i += 1) {
      expect(gate.check(`Bearer ${SECRET}`, '7.7.7.7')).toBe('OK');
    }
    expect(gate.check('Bearer mauvais', '7.7.7.7')).toBe('UNAUTHORIZED');
  });

  it('une adresse inconnue partage un seul compteur plutot que de n en avoir aucun', () => {
    const { gate } = build();
    for (let i = 0; i < ADMIN_FAILURE_LIMIT; i += 1) gate.check('Bearer x', undefined);
    expect(gate.check(`Bearer ${SECRET}`, undefined)).toBe('RATE_LIMITED');
  });

  it('borne sa memoire : une rafale d adresses ne la fait pas grossir sans fin', () => {
    const { gate } = build();
    for (let i = 0; i < 50_000; i += 1)
      gate.check('Bearer x', `10.0.${String(i >> 8)}.${String(i & 255)}`);
    expect(gate.trackedAddresses).toBeLessThanOrEqual(10_000);
  });
});
