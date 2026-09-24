import { JOINT_NAMES, type Animation, type JointName } from '@aura/content';
import { describe, expect, it } from 'vitest';
import { ANIMATIONS } from '../content/animations.js';
import type { Pose } from './pose.js';
import { samplePose } from './sample.js';
import { livePose, SECONDARY_REACH } from './secondary.js';
import { breatheInto } from './smooth.js';

const all = [...ANIMATIONS.values()];
const byId = (id: string): Animation => {
  const found = ANIMATIONS.get(id);
  if (found === undefined) throw new Error(`animation absente : ${id}`);
  return found;
};

const FULL = { hype: 1, reducedMotion: false } as const;
const SEATS = [0, 1.7] as const;

const gap = (a: readonly number[], b: readonly number[]): number =>
  Math.hypot((a[0] ?? 0) - (b[0] ?? 0), (a[1] ?? 0) - (b[1] ?? 0), (a[2] ?? 0) - (b[2] ?? 0));

/** Instants repartis sur trois boucles : le transfert de poids n a pas la periode de la danse. */
function* instants(animation: Animation, count = 48): Generator<number> {
  for (let i = 0; i < count; i++) yield (i / count) * animation.loop.duration * 3;
}

/** Plus grand ecart, sur la boucle, d une articulation entre deux series de poses. */
function travel(poses: readonly Pose[], joint: JointName): number {
  let widest = 0;
  for (const a of poses)
    for (const b of poses) widest = Math.max(widest, gap(a.joints[joint], b.joints[joint]));
  return widest;
}

describe('livePose', () => {
  it('est deterministe et ne touche pas au contenu', () => {
    const dab = byId('anim.hype.t0.dab');
    const before = JSON.stringify(dab);
    expect(livePose(dab, 0.83, 1.7, FULL)).toEqual(livePose(dab, 0.83, 1.7, FULL));
    expect(JSON.stringify(dab)).toBe(before);
  });

  it('ne garde que la respiration sous prefers-reduced-motion', () => {
    for (const animation of all) {
      for (const t of [0, 0.37, 1.9]) {
        const quiet = livePose(animation, t, 1.7, { hype: 1, reducedMotion: true });
        expect(quiet).toEqual(breatheInto(samplePose(animation, t, 1.7), t, 1.7));
      }
    }
  });

  /**
   * La borne que le cadrage ajoute a sa mesure (`bounds.ts`). Si elle cede, la
   * vitrine coupe une main ou un sommet de crane sans qu aucun test de cadrage
   * ne le voie : eux mesurent la pose ecrite plus cette marge.
   */
  it(`ne s ecarte jamais de plus de ${String(SECONDARY_REACH)} cm de la pose ecrite`, () => {
    const fautes: string[] = [];
    for (const animation of all) {
      for (const seat of SEATS) {
        for (const t of instants(animation)) {
          const written = samplePose(animation, t, seat);
          const shown = livePose(animation, t, seat, FULL);
          for (const joint of JOINT_NAMES) {
            const moved = gap(shown.joints[joint], written.joints[joint]);
            if (moved > SECONDARY_REACH + 1e-9) {
              fautes.push(`${animation.id} ${joint} t=${t.toFixed(2)} : ${moved.toFixed(2)} cm`);
            }
          }
        }
      }
    }
    expect(fautes.slice(0, 5)).toEqual([]);
  });

  it('laisse les pieds plantes : aucune couche ne les deplace', () => {
    for (const animation of all) {
      for (const t of instants(animation, 12)) {
        const written = samplePose(animation, t, 0);
        const shown = livePose(animation, t, 0, FULL);
        expect(shown.joints.lf, animation.id).toEqual(written.joints.lf);
        expect(shown.joints.rf, animation.id).toEqual(written.joints.rf);
      }
    }
  });

  /**
   * Les poses tenues se lisent a la position des mains CONTRE le buste : bras
   * croises, mains dans le dos, main en poche, T-pose, index sur la bouche.
   * Le haut du corps bouge d un bloc, donc cet ecart ne doit presque pas
   * changer — sinon les bras decroisent et la main sort de la poche.
   */
  it('garde lisibles les poses tenues', () => {
    const held = [
      'anim.calme.t0.crossed',
      'anim.calme.t0.behind',
      'anim.calme.t1.pocket',
      'anim.provoc.t1.tpose',
      'anim.provoc.t0.shush',
      'anim.calme.t3.meditate',
    ];
    for (const id of held) {
      const animation = byId(id);
      for (const t of instants(animation, 24)) {
        const written = samplePose(animation, t, 0);
        const shown = livePose(animation, t, 0, FULL);
        for (const hand of ['lh', 'rh'] as const) {
          const drift = gap(
            [0, 1, 2].map((i) => shown.joints[hand][i]! - shown.joints.neck[i]!),
            [0, 1, 2].map((i) => written.joints[hand][i]! - written.joints.neck[i]!),
          );
          expect(drift, `${id} ${hand} t=${t.toFixed(2)}`).toBeLessThan(1);
        }
      }
    }
  });

  it('ne fait ni balancer ni rebondir un corps qui ne tient pas debout', () => {
    // Levitation et meditation flottent ; le salto est en l air la moitie du temps.
    for (const id of ['anim.calme.t4.levitate', 'anim.calme.t3.meditate']) {
      const animation = byId(id);
      for (const t of instants(animation, 12)) {
        expect(livePose(animation, t, 0, FULL).joints.hip).toEqual(
          samplePose(animation, t, 0).joints.hip,
        );
      }
    }
  });

  it('fait rebondir les genoux des danses hype, plus fort avec la ferveur', () => {
    const shoulders = byId('anim.hype.t1.shoulders');
    const hipTravel = (hype: number): number => {
      const times = [...instants(shoulders, 96)];
      const poses = times.map((t) => livePose(shoulders, t, 0, { hype, reducedMotion: false }));
      // Contre la pose ecrite : la danse bouge deja un peu le bassin.
      const ys = poses.map(
        (pose, i) => pose.joints.hip[1] - samplePose(shoulders, times[i]!).joints.hip[1],
      );
      return Math.max(...ys) - Math.min(...ys);
    };
    const calm = hipTravel(0);
    const fervent = hipTravel(1);
    expect(calm).toBeGreaterThan(1);
    expect(fervent).toBeGreaterThan(calm * 1.8);
    // Les genoux flechissent vers l avant, ils ne s enfoncent pas droit.
    const dipped = livePose(shoulders, shoulders.loop.duration / 4, 0, FULL);
    expect(dipped.joints.lk[0]).toBeGreaterThan(
      samplePose(shoulders, shoulders.loop.duration / 4).joints.lk[0],
    );
  });

  it('ne fait pas rebondir une danse calme', () => {
    const stride = byId('anim.calme.t1.stride');
    for (const t of instants(stride, 24)) {
      expect(livePose(stride, t, 0, FULL).joints.hip[1]).toBe(samplePose(stride, t).joints.hip[1]);
    }
  });

  it('transfere le poids d une jambe a l autre, et pas a l unisson des deux sieges', () => {
    const crossed = byId('anim.calme.t0.crossed');
    const poses = [...instants(crossed, 48)].map((t) => livePose(crossed, t, 0, FULL));
    expect(travel(poses, 'hip')).toBeGreaterThan(2);
    const a = livePose(crossed, 0.6, 0, FULL).joints.hip[2];
    const b = livePose(crossed, 0.6, 1.7, FULL).joints.hip[2];
    expect(Math.abs(a - b)).toBeGreaterThan(0.5);
  });

  it('fait trainer la main derriere un coude qui part vite', () => {
    // Le dab : le coude droit monte d un coup ; la main arrive un peu apres.
    const dab = byId('anim.hype.t0.dab');
    let widest = 0;
    for (const t of instants(dab, 96)) {
      const written = samplePose(dab, t);
      const shown = livePose(dab, t, 0, { hype: 0, reducedMotion: false });
      // On retire ce que le buste emporte avec lui pour ne garder que le trainage.
      const carried = gap(shown.joints.re, written.joints.re);
      widest = Math.max(widest, gap(shown.joints.rh, written.joints.rh) - carried);
    }
    expect(widest).toBeGreaterThan(1);
  });

  it('fait regarder la tete en retard sur un corps qui tourne', () => {
    const spin = byId('anim.hype.t3.spin');
    let widest = 0;
    for (const t of instants(spin, 96)) {
      widest = Math.max(widest, Math.abs(livePose(spin, t, 0, FULL).hy - samplePose(spin, t).hy));
    }
    expect(widest).toBeGreaterThan(0.1);
    expect(widest).toBeLessThanOrEqual(0.35 + 1e-9);
  });
});
