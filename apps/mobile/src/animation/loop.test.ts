import { JOINT_NAMES, type Animation } from '@aura/content';
import { describe, expect, it } from 'vitest';
import { ANIMATIONS } from '../content/animations.js';
import { samplePose } from './sample.js';
import { createPoseSmoother } from './smooth.js';

/**
 * La boucle des 26 memes.
 *
 * Sur l accueil, le joueur regarde le meme mouvement tourner en rond pendant
 * qu il inspecte son personnage : le moindre a-coup a la reprise se voit, et se
 * voit encore mieux qu en match ou il passe une fois.
 */

const all = [...ANIMATIONS.values()];

/** Deplacement total des articulations entre deux poses, en centimetres. */
function distance(a: ReturnType<typeof samplePose>, b: ReturnType<typeof samplePose>): number {
  let total = 0;
  for (const name of JOINT_NAMES) {
    const p = a.joints[name];
    const q = b.joints[name];
    total += Math.hypot(q[0] - p[0], q[1] - p[1], q[2] - p[2]);
  }
  return total;
}

/** Les ecarts entre images consecutives sur un tour complet. */
function steps(animation: Animation, count: number): number[] {
  const out: number[] = [];
  const dt = animation.loop.duration / count;
  let previous = samplePose(animation, 0);
  for (let i = 1; i <= count; i++) {
    const pose = samplePose(animation, i * dt);
    out.push(distance(previous, pose));
    previous = pose;
  }
  return out;
}

const median = (values: readonly number[]): number => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] ?? 0;
};

describe('bouclage des animations', () => {
  it('revient exactement a sa pose de depart au bout d un cycle', () => {
    for (const animation of all) {
      const start = samplePose(animation, 0);
      const end = samplePose(animation, animation.loop.duration);
      expect(distance(start, end), animation.id).toBeLessThan(1e-9);
      // Les angles aussi : un `rot` qui ne reboucle pas fait pivoter le
      // personnage d un cran a chaque tour.
      expect(end.rot, animation.id).toBeCloseTo(start.rot, 9);
      expect(end.hy, animation.id).toBeCloseTo(start.hy, 9);
      expect(end.pitch, animation.id).toBeCloseTo(start.pitch, 9);
      expect(end.lift, animation.id).toBeCloseTo(start.lift, 9);
    }
  });

  /**
   * Revenir au meme endroit ne suffit pas : il faut y revenir a la meme
   * vitesse. Une boucle qui se referme mais change de vitesse au passage se
   * lit comme un hoquet, et c est le defaut le plus visible d une danse en
   * boucle.
   */
  it('ne marque aucun a-coup a la reprise', () => {
    const count = 240;
    for (const animation of all) {
      const gaps = steps(animation, count);
      const seam = gaps[gaps.length - 1] ?? 0;
      const typical = median(gaps);
      const worst = Math.max(...gaps);
      // La couture ne doit pas etre le pas le plus grand de la boucle, ni
      // depasser beaucoup le pas courant.
      expect(seam, `${animation.id} (couture)`).toBeLessThanOrEqual(worst + 1e-9);
      expect(seam, `${animation.id} (couture vs courant)`).toBeLessThan(typical * 3 + 0.5);
    }
  });

  it('ne teleporte jamais une articulation d une image a l autre', () => {
    for (const animation of all) {
      // Autant d echantillons que d images a 60 i/s sur un cycle.
      const count = Math.max(2, Math.round(animation.loop.duration * 60));
      const dt = animation.loop.duration / count;
      let worst = 0;
      let previous = samplePose(animation, 0);
      for (let i = 1; i <= count; i++) {
        const pose = samplePose(animation, i * dt);
        for (const name of JOINT_NAMES) {
          const a = previous.joints[name];
          const b = pose.joints[name];
          worst = Math.max(worst, Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]));
        }
        previous = pose;
      }
      /**
       * Vingt centimetres par image a 60 i/s, soit douze metres par seconde.
       * Le salto arriere, le plus violent des vingt-six, tient dessous : au
       * dela ce n est plus un geste rapide mais une discontinuite.
       */
      expect(worst, animation.id).toBeLessThan(20);
    }
  });

  it('est periodique : deux tours plus tard, la meme pose', () => {
    for (const animation of all) {
      const d = animation.loop.duration;
      for (const u of [0.13, 0.5, 0.87]) {
        const once = samplePose(animation, u * d);
        const thrice = samplePose(animation, u * d + 3 * d);
        expect(distance(once, thrice), `${animation.id} @ ${String(u)}`).toBeLessThan(1e-6);
      }
    }
  });
});

describe('changement de meme dans la vitrine', () => {
  /**
   * Le joueur parcourt la galerie : d un mouvement a l autre, le personnage ne
   * doit pas sauter. Le ressort de `smooth.ts` est exactement fait pour ca —
   * ce test verifie qu il est bien ce qui separe les deux poses.
   */
  it('glisse d un meme a l autre au lieu de sauter', () => {
    const from = ANIMATIONS.get('anim.calme.t0.crossed')!;
    const to = ANIMATIONS.get('anim.provoc.t1.tpose')!;

    const smoother = createPoseSmoother();
    // On s installe d abord sur le premier meme.
    let current = smoother.step(samplePose(from, 0), 1 / 60);
    for (let i = 0; i < 120; i++) current = smoother.step(samplePose(from, i / 60), 1 / 60);

    const target = samplePose(to, 0);
    const gapBefore = distance(current, target);
    expect(gapBefore).toBeGreaterThan(10);

    // Premiere image du nouveau meme : on ne fait qu une fraction du chemin.
    const firstFrame = smoother.step(target, 1 / 60);
    expect(distance(current, firstFrame)).toBeLessThan(gapBefore * 0.35);

    // Et en un demi-seconde, on y est.
    let settled = firstFrame;
    for (let i = 0; i < 30; i++) settled = smoother.step(target, 1 / 60);
    expect(distance(settled, target)).toBeLessThan(gapBefore * 0.05);
  });

  it('rejoint chaque meme du catalogue sans jamais diverger', () => {
    // Le ressort depasse un peu : on verifie qu il revient toujours, quel que
    // soit l ecart entre les deux poses.
    const smoother = createPoseSmoother();
    smoother.reset(samplePose(all[0]!, 0));
    for (const animation of all) {
      const target = samplePose(animation, 0);
      let pose = smoother.step(target, 1 / 60);
      for (let i = 0; i < 90; i++) pose = smoother.step(target, 1 / 60);
      expect(distance(pose, target), animation.id).toBeLessThan(1);
    }
  });
});
