import { describe, expect, it } from 'vitest';
import { banUntil, optionalReason, parseRollout, requiredReason } from './forms.js';

const NOW = Date.parse('2026-09-26T12:00:00.000Z');
const DAY = 86_400_000;

describe('duree de bannissement → until', () => {
  it('1, 7 et 30 jours partent de maintenant', () => {
    expect(banUntil('1d', NOW)).toEqual({ ok: true, value: new Date(NOW + DAY).toISOString() });
    expect(banUntil('7d', NOW)).toEqual({ ok: true, value: new Date(NOW + 7 * DAY).toISOString() });
    expect(banUntil('30d', NOW)).toEqual({
      ok: true,
      value: new Date(NOW + 30 * DAY).toISOString(),
    });
  });

  it('definitif : null', () => {
    expect(banUntil('permanent', NOW)).toEqual({ ok: true, value: null });
  });

  it('date precise : lue en heure locale, rendue en ISO UTC', () => {
    const local = '2026-10-03T18:30';
    const result = banUntil('date', NOW, local);
    expect(result).toEqual({ ok: true, value: new Date(local).toISOString() });
  });

  it('date precise : absente, illisible ou passee est refusee', () => {
    expect(banUntil('date', NOW, '').ok).toBe(false);
    expect(banUntil('date', NOW, 'demain').ok).toBe(false);
    expect(banUntil('date', NOW, '2020-01-01T00:00')).toEqual({
      ok: false,
      error: 'La date de fin doit être dans le futur.',
    });
  });
});

describe('motif', () => {
  it('obligatoire : vide ou blanc refuse', () => {
    expect(requiredReason('')).toEqual({ ok: false, error: 'Le motif est obligatoire.' });
    expect(requiredReason('   ').ok).toBe(false);
  });

  it('obligatoire : bornes du contrat (3 a 200), espaces retires', () => {
    expect(requiredReason('ab').ok).toBe(false);
    expect(requiredReason('  abc  ')).toEqual({ ok: true, value: 'abc' });
    expect(requiredReason('x'.repeat(200)).ok).toBe(true);
    expect(requiredReason('x'.repeat(201)).ok).toBe(false);
  });

  it('facultatif : vide = absent, sinon memes bornes', () => {
    expect(optionalReason('  ')).toEqual({ ok: true, value: undefined });
    expect(optionalReason('ab').ok).toBe(false);
    expect(optionalReason('test A/B')).toEqual({ ok: true, value: 'test A/B' });
  });
});

describe('part d une nouvelle mesure', () => {
  it('accepte un entier de 1 a 100', () => {
    expect(parseRollout('1')).toEqual({ ok: true, value: 1 });
    expect(parseRollout(' 100 ')).toEqual({ ok: true, value: 100 });
  });

  it('refuse 0, plus de 100, un decimal, un negatif, du texte', () => {
    for (const raw of ['0', '101', '12.5', '-3', 'moitié', '']) {
      expect(parseRollout(raw).ok, raw).toBe(false);
    }
  });
});
