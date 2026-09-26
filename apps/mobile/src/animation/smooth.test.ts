import { JOINT_NAMES } from '@aura/content';
import { describe, expect, it } from 'vitest';
import type { Pose } from './pose.js';
import { breatheInto, createPoseSmoother } from './smooth.js';

const pose = (x: number, y = 0, extra: Partial<Pose> = {}): Pose => ({
  joints: Object.fromEntries(
    JOINT_NAMES.map((j) => [j, [x, y, 0] as const]),
  ) as unknown as Pose['joints'],
  lift: 0,
  rot: 0,
  hy: 0,
  pitch: 0,
  ...extra,
});

/** Avance le lisseur de `seconds` en pas de `dt`. */
function run(
  smoother: ReturnType<typeof createPoseSmoother>,
  target: Pose,
  seconds: number,
  dt: number,
): Pose {
  let out = smoother.step(target, dt);
  for (let t = dt; t < seconds - 1e-9; t += dt) out = smoother.step(target, dt);
  return out;
}

describe('createPoseSmoother', () => {
  it('part exactement sur la premiere pose, sans glisser depuis zero', () => {
    const smoother = createPoseSmoother();
    const out = smoother.step(pose(50), 1 / 60);
    // Sans cette amorce, tout personnage naitrait a l'origine et s'y
    // precipiterait pendant une demi-seconde a chaque apparition.
    expect(out.joints.hip[0]).toBeCloseTo(50, 6);
  });

  it('rejoint une nouvelle cible', () => {
    const smoother = createPoseSmoother();
    smoother.step(pose(0), 1 / 60);
    const out = run(smoother, pose(100), 1.5, 1 / 60);
    expect(out.joints.hip[0]).toBeCloseTo(100, 1);
  });

  it('ne saute pas : au premier pas il reste loin de la cible', () => {
    const smoother = createPoseSmoother();
    smoother.step(pose(0), 1 / 60);
    const out = smoother.step(pose(100), 1 / 60);
    // C'est tout l'objet du lisseur : un changement d'animation doit se
    // parcourir, pas se teleporter.
    expect(out.joints.hip[0]).toBeGreaterThan(0);
    expect(out.joints.hip[0]).toBeLessThan(45);
  });

  /**
   * Le pas interne est fixe. Sans cela, un telephone a 30 images par seconde et
   * un autre a 120 ne joueraient pas la meme animation — et le ressort
   * deviendrait instable des que le navigateur saute une image.
   */
  it('donne le meme resultat quel que soit le decoupage du temps', () => {
    const a = createPoseSmoother();
    const b = createPoseSmoother();
    a.step(pose(0), 1 / 120);
    b.step(pose(0), 1 / 120);
    const slow = run(a, pose(100), 0.5, 1 / 30);
    const fast = run(b, pose(100), 0.5, 1 / 120);
    expect(slow.joints.hip[0]).toBeCloseTo(fast.joints.hip[0], 6);
  });

  /**
   * Les extremites suivent avec un leger retard : c'est ce decalage qui donne
   * l'impression d'un corps entraine, et non d'un pantin rigide.
   */
  it('laisse les extremites trainer derriere le buste', () => {
    const smoother = createPoseSmoother();
    smoother.step(pose(0), 1 / 60);
    const out = run(smoother, pose(100), 0.1, 1 / 120);
    expect(out.joints.head[0]).toBeLessThan(out.joints.neck[0]);
    expect(out.joints.lh[0]).toBeLessThan(out.joints.le[0]);
  });

  /**
   * Les angles prennent le plus court chemin. Sans cela une boucle qui repasse
   * de +170 a -170 degres fait faire au personnage un tour complet.
   */
  it('tourne par le plus court chemin', () => {
    const smoother = createPoseSmoother();
    smoother.step(pose(0, 0, { rot: 3.0 }), 1 / 60);
    for (let i = 0; i < 6; i++) {
      const out = smoother.step(pose(0, 0, { rot: -3.0 }), 1 / 120);
      expect(Math.abs(out.rot)).toBeGreaterThan(2.9);
    }
  });

  it('ne fait jamais passer l elevation au-dessus de zero', () => {
    const smoother = createPoseSmoother();
    smoother.step(pose(0, 0, { lift: -30 }), 1 / 60);
    for (let i = 0; i < 200; i++) {
      expect(smoother.step(pose(0, 0, { lift: 0 }), 1 / 120).lift).toBeLessThanOrEqual(0);
    }
  });

  it('est deterministe', () => {
    const one = createPoseSmoother();
    const two = createPoseSmoother();
    one.step(pose(0), 1 / 60);
    two.step(pose(0), 1 / 60);
    expect(run(one, pose(80), 0.3, 1 / 60)).toEqual(run(two, pose(80), 0.3, 1 / 60));
  });

  it('accepte un pas nul sans produire de NaN', () => {
    const smoother = createPoseSmoother();
    smoother.step(pose(10), 1 / 60);
    const out = smoother.step(pose(90), 0);
    expect(Number.isFinite(out.joints.hip[0])).toBe(true);
    expect(out.joints.hip[0]).toBeCloseTo(10, 6);
  });

  /**
   * Une image perdue — onglet en arriere-plan, garbage collector — ne doit pas
   * faire exploser le ressort ni le faire courir sur cinq secondes de rattrapage.
   */
  it('borne un pas de temps aberrant', () => {
    const smoother = createPoseSmoother();
    smoother.step(pose(0), 1 / 60);
    const out = smoother.step(pose(100), 30);
    expect(Number.isFinite(out.joints.hip[0])).toBe(true);
    expect(out.joints.hip[0]).toBeLessThanOrEqual(101);
  });
});

describe('breatheInto', () => {
  it('fait respirer le buste et la tete', () => {
    const still = pose(0);
    const a = breatheInto(still, 0, 0);
    const b = breatheInto(still, 0.75, 0);
    expect(a.joints.head[1]).not.toBeCloseTo(b.joints.head[1], 4);
    expect(a.joints.neck[1]).not.toBeCloseTo(b.joints.neck[1], 4);
  });

  it('laisse les pieds au sol : on ne respire pas des chevilles', () => {
    const still = pose(0);
    for (const t of [0, 0.4, 1.1, 2.7]) {
      expect(breatheInto(still, t, 0).joints.lf).toEqual(still.joints.lf);
      expect(breatheInto(still, t, 0).joints.rf).toEqual(still.joints.rf);
    }
  });

  it('reste un micro-mouvement, jamais une animation', () => {
    for (let t = 0; t < 6; t += 0.05) {
      const moved = breatheInto(pose(0), t, 0.7);
      for (const joint of JOINT_NAMES) {
        expect(Math.abs(moved.joints[joint][1])).toBeLessThan(2);
      }
    }
  });

  it('decale les personnages entre eux', () => {
    // Deux combattants qui respirent a l'unisson se lisent comme des clones.
    expect(breatheInto(pose(0), 1, 0).joints.head[1]).not.toBeCloseTo(
      breatheInto(pose(0), 1, 1.7).joints.head[1],
      4,
    );
  });

  it('ne modifie pas la pose qu on lui donne', () => {
    const original = pose(0);
    const before = original.joints.head[1];
    breatheInto(original, 1.3, 0);
    expect(original.joints.head[1]).toBe(before);
  });
});
