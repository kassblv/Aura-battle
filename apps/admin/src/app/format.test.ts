import { describe, expect, it } from 'vitest';
import {
  ago,
  duration,
  gap,
  measure,
  prettyJson,
  signedPercent,
  utcDay,
  WEEK_MS,
} from './format.js';

describe('formats', () => {
  it('une valeur selon son unite', () => {
    expect(measure(0.425, 'ratio')).toBe('42,5 %');
    expect(measure(12_300, 'ms')).toBe('12,3 s');
    expect(measure(3.456, 'perDay')).toBe('3,46');
    expect(measure(null, 'ratio')).toBe('—');
  });

  it('l ecart relatif d une valeur a sa reference, ou rien quand il ne se calcule pas', () => {
    expect(gap(44, 40)).toBeCloseTo(0.1, 10);
    expect(gap(30, 40)).toBeCloseTo(-0.25, 10);
    expect(gap(null, 40)).toBeNull();
    expect(gap(44, null)).toBeNull();
    expect(gap(44, 0)).toBeNull();
  });

  it('un ecart signe, en %, sans signe pour zero', () => {
    expect(signedPercent(0.09)).toBe('+9 %');
    expect(signedPercent(-0.125)).toBe('−12,5 %');
    expect(signedPercent(0)).toBe('0 %');
    expect(signedPercent(null)).toBe('—');
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
