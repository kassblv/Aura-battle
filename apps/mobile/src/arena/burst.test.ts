import { describe, expect, it } from 'vitest';
import { ULTIMATE_GOLD, impactBurst, knockbackDistance, revealBurst } from './burst.js';
import type { ClashSpec } from './clash.js';

const colors = { a: '#7cf2ff', b: '#ff6b81' } as const;

const spec = (over: Partial<ClashSpec> = {}): ClashSpec => ({
  winner: 'a',
  counter: null,
  ultimate: null,
  ...over,
});

describe('revealBurst', () => {
  it('prend la couleur d aura du combattant', () => {
    const script = revealBurst({ color: '#7cf2ff', ultimate: false });
    expect(script.sparks.colors).toContain('#7cf2ff');
    expect(script.rings.map((r) => r.color)).toEqual(['#7cf2ff']);
  });

  it('pose son anneau au sol', () => {
    expect(revealBurst({ color: '#7cf2ff', ultimate: false }).rings[0]!.plane).toBe('ground');
  });

  it('passe a l or et double l onde sur un Ultime', () => {
    const plain = revealBurst({ color: '#7cf2ff', ultimate: false });
    const ultimate = revealBurst({ color: '#7cf2ff', ultimate: true });
    expect(ultimate.sparks.count).toBeGreaterThan(plain.sparks.count);
    expect(ultimate.sparks.speed).toBeGreaterThan(plain.sparks.speed);
    expect(ultimate.sparks.colors).toContain(ULTIMATE_GOLD);
    expect(ultimate.rings).toHaveLength(2);
  });
});

/*
  Le coeur de la promesse : trois issues, trois images. Un joueur qui ne lit pas
  le bandeau doit savoir, a la seule gerbe, si la manche s est gagnee au score,
  par un contre ou par un Ultime.
*/
describe('impactBurst', () => {
  it('reste blanc et sobre sur une manche gagnee au score', () => {
    const script = impactBurst(spec(), colors);
    expect(script.rings.map((r) => r.color)).toEqual(['#ffffff']);
    expect(script.sparks.colors).toContain(colors.a);
  });

  it('prend la couleur de celui qui contre, et double l onde', () => {
    const script = impactBurst(spec({ counter: 'b' }), colors);
    expect(script.sparks.colors).toContain(colors.b);
    expect(script.rings).toHaveLength(2);
    expect(new Set(script.rings.map((r) => r.color))).toEqual(new Set([colors.b]));
    expect(new Set(script.rings.map((r) => r.plane))).toEqual(new Set(['upright', 'ground']));
  });

  it('passe tout a l or sur un Ultime, et frappe plus fort qu un contre', () => {
    const counter = impactBurst(spec({ counter: 'a' }), colors);
    const ultimate = impactBurst(spec({ ultimate: 'a' }), colors);
    expect(new Set(ultimate.rings.map((r) => r.color))).toEqual(new Set([ULTIMATE_GOLD]));
    expect(ultimate.sparks.count).toBeGreaterThan(counter.sparks.count);
    expect(ultimate.sparks.speed).toBeGreaterThan(counter.sparks.speed);
    expect(Math.max(...ultimate.rings.map((r) => r.radius))).toBeGreaterThan(
      Math.max(...counter.rings.map((r) => r.radius)),
    );
  });

  it('se contente d un heurt sur une manche nulle', () => {
    const draw = impactBurst(spec({ winner: null }), colors);
    const plain = impactBurst(spec(), colors);
    expect(draw.sparks.count).toBeLessThan(plain.sparks.count);
    expect(draw.rings[0]!.radius).toBeLessThan(plain.rings[0]!.radius);
    // Les deux couleurs sont la : personne ne l a emporte.
    expect(draw.sparks.colors).toContain(colors.a);
    expect(draw.sparks.colors).toContain(colors.b);
  });

  it('classe les quatre issues par ampleur de gerbe', () => {
    const count = (over: Partial<ClashSpec>): number =>
      impactBurst(spec(over), colors).sparks.count;
    expect(count({ ultimate: 'a' })).toBeGreaterThan(count({ counter: 'a' }));
    expect(count({ counter: 'a' })).toBeGreaterThan(count({}));
    expect(count({})).toBeGreaterThan(count({ winner: null }));
  });
});

describe('knockbackDistance', () => {
  it('ne pousse personne sur une manche nulle', () => {
    expect(knockbackDistance(spec({ winner: null }))).toBe(0);
  });

  it('pousse plus loin a mesure que l issue est forte', () => {
    expect(knockbackDistance(spec({ ultimate: 'a' }))).toBeGreaterThan(
      knockbackDistance(spec({ counter: 'a' })),
    );
    expect(knockbackDistance(spec({ counter: 'a' }))).toBeGreaterThan(knockbackDistance(spec()));
  });

  it('ignore un contre ou un Ultime porte par le perdant', () => {
    expect(knockbackDistance(spec({ winner: 'a', counter: 'b' }))).toBe(knockbackDistance(spec()));
    expect(knockbackDistance(spec({ winner: 'a', ultimate: 'b' }))).toBe(knockbackDistance(spec()));
  });
});
