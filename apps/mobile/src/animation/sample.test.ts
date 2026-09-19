import { JOINT_NAMES, type Animation, type AnimationFrame } from '@aura/content';
import { describe, expect, it } from 'vitest';
import { samplePose } from './sample.js';

const flat = (x: number, y: number): AnimationFrame['joints'] =>
  Object.fromEntries(
    JOINT_NAMES.map((joint) => [joint, [x, y] as const]),
  ) as unknown as AnimationFrame['joints'];

const animation = (frames: readonly AnimationFrame[], loop: Partial<Animation['loop']> = {}) =>
  ({
    id: 'anim.test',
    version: 1,
    name: { fr: 'Test' },
    move: { style: 'calme', tier: 0 },
    loop: { duration: 1, ...loop },
    hands: [],
    frames,
  }) satisfies Animation;

describe('samplePose', () => {
  it('rend la pose telle quelle quand l animation ne compte qu une image', () => {
    const pose = samplePose(animation([{ joints: flat(3, -7) }]), 0.42);
    expect(pose.joints.head).toEqual([3, -7, 0]);
    expect(pose.lift).toBe(0);
  });

  it('passe exactement par chaque image cle', () => {
    const anim = animation([{ joints: flat(0, 0) }, { joints: flat(100, 0) }]);
    expect(samplePose(anim, 0).joints.hip[0]).toBeCloseTo(0, 6);
    expect(samplePose(anim, 0.5).joints.hip[0]).toBeCloseTo(100, 6);
  });

  it('boucle : un cycle entier ramene a la meme pose', () => {
    const anim = animation([{ joints: flat(0, 0) }, { joints: flat(50, -10) }], { duration: 0.8 });
    // A la tolerance pres, et pas a l'egalite stricte : 0,3 + 0,8 puis division
    // par 0,8 ne redonne pas 0,375 en binaire. Exiger l'exactitude testerait
    // l'arithmetique flottante, pas le bouclage.
    for (const cycles of [1, 5, 40]) {
      const later = samplePose(anim, 0.3 + 0.8 * cycles);
      expect(later.joints.hip[0]).toBeCloseTo(samplePose(anim, 0.3).joints.hip[0], 6);
      expect(later.joints.hip[1]).toBeCloseTo(samplePose(anim, 0.3).joints.hip[1], 6);
    }
  });

  it('accepte un temps negatif sans sortir de la boucle', () => {
    const anim = animation([{ joints: flat(0, 0) }, { joints: flat(50, 0) }], { duration: 0.8 });
    expect(samplePose(anim, -0.5).joints.hip[0]).toBeCloseTo(
      samplePose(anim, 0.3).joints.hip[0],
      6,
    );
  });

  it('lit la profondeur, absente valant zero', () => {
    const anim = animation([{ joints: flat(0, 0), z: { lh: 12 } }]);
    const pose = samplePose(anim, 0);
    expect(pose.joints.lh[2]).toBe(12);
    expect(pose.joints.rh[2]).toBe(0);
  });

  /**
   * Les parts sont relatives a leur somme : une image qui occupe 75 % de la
   * boucle est encore au debut de sa course a la moitie du cycle.
   */
  it('respecte les parts de chaque image', () => {
    const anim = animation([{ joints: flat(0, 0) }, { joints: flat(100, 0) }], {
      weights: [0.75, 0.25],
    });
    // A t = 0,75 la premiere image finit : on doit etre arrive a la seconde.
    expect(samplePose(anim, 0.75).joints.hip[0]).toBeCloseTo(100, 6);
    // A la moitie du cycle, seuls deux tiers de la premiere image sont passes.
    expect(samplePose(anim, 0.5).joints.hip[0]).toBeLessThan(100);
  });

  it('normalise des parts qui ne somment pas a un', () => {
    const doubled = animation([{ joints: flat(0, 0) }, { joints: flat(100, 0) }], {
      weights: [1.5, 0.5],
    });
    const same = animation([{ joints: flat(0, 0) }, { joints: flat(100, 0) }], {
      weights: [0.75, 0.25],
    });
    expect(samplePose(doubled, 0.5)).toEqual(samplePose(same, 0.5));
  });

  /**
   * Les angles bouclent : passer de +170° a -170° est un pas de 20°, pas de
   * 340°. Sans le plus court chemin, le personnage fait un tour sur lui-meme
   * a chaque bouclage.
   */
  it('interpole les angles par le plus court chemin', () => {
    const anim = animation(
      [
        { joints: flat(0, 0), rot: 3.0 },
        { joints: flat(0, 0), rot: -3.0 },
      ],
      { duration: 1 },
    );
    // Le chemin court passe par |angle| > 3, pas par zero.
    for (const t of [0.55, 0.6, 0.7]) {
      expect(Math.abs(samplePose(anim, t).rot)).toBeGreaterThan(3.0);
    }
  });

  it('borne l elevation a zero : un personnage ne s enfonce pas dans le sol', () => {
    const anim = animation([
      { joints: flat(0, 0), lift: -30 },
      { joints: flat(0, 0), lift: 0 },
      { joints: flat(0, 0), lift: 0 },
    ]);
    for (let t = 0; t < 1; t += 0.02) {
      expect(samplePose(anim, t).lift).toBeLessThanOrEqual(0);
    }
  });

  it('est deterministe : deux appels au meme instant donnent la meme pose', () => {
    const anim = animation([
      { joints: flat(0, 0) },
      { joints: flat(20, -5) },
      { joints: flat(-8, 3) },
    ]);
    expect(samplePose(anim, 0.37)).toEqual(samplePose(anim, 0.37));
  });

  it('rend toutes les articulations, toujours', () => {
    const pose = samplePose(animation([{ joints: flat(1, 2) }]), 0.1);
    expect(Object.keys(pose.joints).sort()).toEqual([...JOINT_NAMES].sort());
  });

  /**
   * Catmull-Rom depasse volontairement les images cles dans les virages : c'est
   * ce qui donne l'elan du prototype. Ce test fixe ce depassement comme
   * intentionnel — une interpolation lineaire ne le produirait pas.
   */
  it('deborde des images cles, comme le prototype', () => {
    // Un plateau aborde avec de l'elan : la courbe le depasse avant d'y revenir.
    // Un pic isole, lui, est atteint a pente nulle et ne deborde pas.
    const anim = animation([
      { joints: flat(0, 0) },
      { joints: flat(100, 0) },
      { joints: flat(100, 0) },
      { joints: flat(0, 0) },
    ]);
    let peak = 0;
    for (let t = 0; t < 1; t += 0.005) peak = Math.max(peak, samplePose(anim, t).joints.hip[0]);
    expect(peak).toBeGreaterThan(100);
  });

  it('adoucit les images quand l animation le demande', () => {
    const frames = [{ joints: flat(0, 0) }, { joints: flat(100, 0) }];
    const brut = samplePose(animation(frames), 0.125).joints.hip[0];
    const adouci = samplePose(animation(frames, { ease: true }), 0.125).joints.hip[0];
    expect(adouci).toBeLessThan(brut);
  });
});
