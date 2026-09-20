import { describe, expect, it } from 'vitest';
import { FX_BUDGET, createFxPool } from './fx.js';
import type { ParticleSink } from './particles.js';

interface Recorded {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly color: string;
  readonly alpha: number;
  readonly size: number;
}

function recorder(): ParticleSink & { readonly points: Recorded[]; readonly opaque: Recorded[] } {
  const points: Recorded[] = [];
  const opaque: Recorded[] = [];
  return {
    points,
    opaque,
    add(x, y, z, color, alpha, size): void {
      points.push({ x, y, z, color, alpha, size });
    },
    dark(x, y, z, color, alpha, size): void {
      opaque.push({ x, y, z, color, alpha, size });
    },
  };
}

/** Un hasard previsible : toujours le milieu de l intervalle. */
const middle = (): number => 0.5;

const origin = { x: 0, y: 1, z: 0 };

describe('createFxPool — gerbes', () => {
  it('fait naitre autant d etincelles que demande', () => {
    const fx = createFxPool({ rng: middle });
    fx.spark(origin, { count: 34, colors: ['#ff0000'], speed: 2.6 });
    expect(fx.count).toBe(34);
  });

  it('parcourt les couleurs a tour de role', () => {
    const fx = createFxPool({ rng: middle });
    fx.spark(origin, { count: 4, colors: ['#ff0000', '#00ff00'], speed: 2.6 });
    const sink = recorder();
    fx.draw(sink);
    expect(sink.points.map((p) => p.color)).toEqual(['#ff0000', '#00ff00', '#ff0000', '#00ff00']);
  });

  it('les deplace, les freine et les fait retomber', () => {
    const fx = createFxPool({ rng: () => 0.9 });
    fx.spark(origin, { count: 1, colors: ['#ffffff'], speed: 3 });
    const before = recorder();
    fx.draw(before);
    fx.update(0.1);
    const after = recorder();
    fx.draw(after);
    expect(after.points[0]!.y).not.toBe(before.points[0]!.y);
    expect(after.points[0]!.alpha).toBeLessThan(before.points[0]!.alpha);
  });

  it('les efface une fois leur vie ecoulee', () => {
    const fx = createFxPool({ rng: middle });
    fx.spark(origin, { count: 10, colors: ['#ffffff'], speed: 2 });
    fx.update(2);
    expect(fx.count).toBe(0);
  });

  it('ne depasse jamais son plafond', () => {
    const fx = createFxPool({ rng: middle, budget: 40 });
    for (let i = 0; i < 10; i++) fx.spark(origin, { count: 30, colors: ['#ffffff'], speed: 2 });
    expect(fx.count).toBeLessThanOrEqual(40);
  });

  it('a un plafond par defaut', () => {
    expect(FX_BUDGET).toBeGreaterThan(0);
  });
});

describe('createFxPool — ondes', () => {
  it('dessine un anneau en un seul tour de points', () => {
    const fx = createFxPool({ rng: middle });
    fx.ring(origin, { color: '#ffcf3f', radius: 1.3, plane: 'ground' });
    const sink = recorder();
    fx.draw(sink);
    expect(sink.points).toHaveLength(48);
    expect(new Set(sink.points.map((p) => p.color))).toEqual(new Set(['#ffcf3f']));
  });

  it('couche l anneau au sol, ou le dresse face au joueur', () => {
    const fx = createFxPool({ rng: middle });
    fx.ring(origin, { color: '#ffffff', radius: 1, plane: 'ground' });
    fx.update(0.3);
    const ground = recorder();
    fx.draw(ground);
    // Au sol, toute la hauteur est la meme et c est la profondeur qui varie.
    expect(new Set(ground.points.map((p) => p.y))).toEqual(new Set([origin.y]));
    expect(new Set(ground.points.map((p) => p.z)).size).toBeGreaterThan(1);

    const other = createFxPool({ rng: middle });
    other.ring(origin, { color: '#ffffff', radius: 1, plane: 'upright' });
    other.update(0.3);
    const upright = recorder();
    other.draw(upright);
    expect(new Set(upright.points.map((p) => p.z))).toEqual(new Set([origin.z]));
    expect(new Set(upright.points.map((p) => p.y)).size).toBeGreaterThan(1);
  });

  it('ouvre vite puis ralentit', () => {
    const radiusAfter = (seconds: number): number => {
      const fx = createFxPool({ rng: middle });
      fx.ring(origin, { color: '#ffffff', radius: 1, plane: 'ground' });
      fx.update(seconds);
      const sink = recorder();
      fx.draw(sink);
      return Math.max(...sink.points.map((p) => Math.abs(p.x - origin.x)));
    };
    const early = radiusAfter(0.15);
    const late = radiusAfter(0.45);
    expect(early).toBeGreaterThan(late / 2);
    expect(late).toBeGreaterThan(early);
  });

  it('s efface en meme temps qu il s ouvre', () => {
    const fx = createFxPool({ rng: middle });
    fx.ring(origin, { color: '#ffffff', radius: 1, plane: 'ground' });
    const start = recorder();
    fx.draw(start);
    fx.update(0.4);
    const end = recorder();
    fx.draw(end);
    expect(end.points[0]!.alpha).toBeLessThan(start.points[0]!.alpha);
  });
});

describe('createFxPool — nettoyage', () => {
  it('se vide d un coup', () => {
    const fx = createFxPool({ rng: middle });
    fx.spark(origin, { count: 20, colors: ['#ffffff'], speed: 2 });
    fx.clear();
    expect(fx.count).toBe(0);
    const sink = recorder();
    fx.draw(sink);
    expect(sink.points).toHaveLength(0);
  });

  it('ignore une image de duree nulle ou negative', () => {
    const fx = createFxPool({ rng: middle });
    fx.spark(origin, { count: 3, colors: ['#ffffff'], speed: 2 });
    fx.update(0);
    fx.update(-1);
    expect(fx.count).toBe(3);
  });
});
