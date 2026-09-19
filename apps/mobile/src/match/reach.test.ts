import { describe, expect, it } from 'vitest';
import { DEAD_ZONE, reachable } from './reach.js';

/** Grille reguliere : on couvre tout le carre unite que le moteur peut produire. */
const grid = (steps = 11): { x: number; y: number }[] => {
  const points: { x: number; y: number }[] = [];
  for (let i = 0; i < steps; i++) {
    for (let j = 0; j < steps; j++) points.push({ x: i / (steps - 1), y: j / (steps - 1) });
  }
  return points;
};

describe('reachable', () => {
  it('reste dans l ecran', () => {
    for (const { x, y } of grid()) {
      const at = reachable(x, y);
      expect(at.left).toBeGreaterThanOrEqual(0);
      expect(at.left).toBeLessThanOrEqual(1);
      expect(at.top).toBeGreaterThanOrEqual(0);
      expect(at.top).toBeLessThanOrEqual(1);
    }
  });

  /**
   * ADR 0008. Le centre haut est la zone morte entre les deux pouces : en
   * paysage, rien d interactif ne doit y tomber. Une orbe qui y apparait est
   * une orbe qu on rate — ou qu on attrape en lachant le telephone.
   */
  it('ne pose jamais rien dans la zone morte', () => {
    for (const { x, y } of grid(21)) {
      const at = reachable(x, y);
      const central = Math.abs(at.left - 0.5) < DEAD_ZONE.halfWidth;
      expect(central && at.top < DEAD_ZONE.below).toBe(false);
    }
  });

  it('laisse le bandeau du haut libre', () => {
    // Le HUD y affiche score et energie : une orbe dessous serait intapable.
    for (const { x, y } of grid(21)) expect(reachable(x, y).top).toBeGreaterThan(0.12);
  });

  it('repartit de part et d autre, pas toutes du meme cote', () => {
    const sides = grid(21).map(({ x, y }) => (reachable(x, y).left < 0.5 ? 'gauche' : 'droite'));
    expect(sides).toContain('gauche');
    expect(sides).toContain('droite');
  });

  it('est deterministe : le serveur et le client doivent voir la meme orbe', () => {
    expect(reachable(0.42, 0.73)).toEqual(reachable(0.42, 0.73));
  });

  it('conserve l ordre horizontal du moteur', () => {
    // Deux orbes generees a gauche et a droite doivent le rester : sinon une
    // sequence pensee pour alterner les mains ne l alterne plus.
    const left = reachable(0.1, 0.5);
    const right = reachable(0.9, 0.5);
    expect(left.left).toBeLessThan(right.left);
  });
});
