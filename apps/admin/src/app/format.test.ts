import { describe, expect, it } from 'vitest';
import { ago, duration, measure, prettyJson, utcDay, WEEK_MS } from './format.js';

describe('formats', () => {
  it('une valeur selon son unite', () => {
    expect(measure(0.425, 'ratio')).toBe('42,5 %');
    expect(measure(12_300, 'ms')).toBe('12,3 s');
    expect(measure(3.456, 'perDay')).toBe('3,46');
    expect(measure(null, 'ratio')).toBe('—');
  });

  it('durees et anciennete', () => {
    expect(duration(42)).toBe('42 s');
    expect(duration(93_600)).toBe('26 h');
    expect(duration(3 * 86_400)).toBe('3 j');
    expect(ago('2026-09-26T11:00:00.000Z', Date.parse('2026-09-26T12:00:00.000Z'))).toBe(
      'il y a 1 h',
    );
  });

  it('une semaine UTC va du lundi au dimanche, quel que soit le fuseau du navigateur', () => {
    const start = '2026-09-21T00:00:00.000Z';
    expect(utcDay(start)).toMatch(/^lun\./);
    expect(utcDay(new Date(Date.parse(start) + WEEK_MS - 1).toISOString())).toMatch(/^dim\. 27/);
  });

  it('JSON lisible, et rien pour une valeur absente', () => {
    expect(prettyJson({ a: 1 })).toBe('{\n  "a": 1\n}');
    expect(prettyJson(undefined)).toBe('—');
    const loop: Record<string, unknown> = {};
    loop.self = loop;
    expect(prettyJson(loop)).toBe('[valeur illisible]');
  });
});
