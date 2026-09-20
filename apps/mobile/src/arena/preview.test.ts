import type { Animation } from '@aura/content';
import { Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import {
  animationBounds,
  forEachWorldJoint,
  LIMB_MARGIN,
  type AnimationBounds,
} from '../animation/bounds.js';
import { ANIMATIONS } from '../content/animations.js';
import { ArenaCameraRig, createArenaCamera, distanceForHeight, previewFraming } from './camera.js';

/**
 * Le cadrage de la vitrine : un mème doit se lire en entier.
 *
 * Ces tests ne dessinent rien, mais ils projettent pour de vrai : la camera de
 * Three.js se construit et se calcule sans WebGL, donc on peut verifier que le
 * personnage tient dans l image plutot que de se fier a une formule.
 */

const all = [...ANIMATIONS.values()];

/** Paysage 844 x 390 : le format que le jeu vise. */
const ASPECT = 844 / 390;

function boundsOf(id: string): AnimationBounds {
  const animation = ANIMATIONS.get(id);
  if (animation === undefined) throw new Error(`animation ${id} absente`);
  return animationBounds(animation);
}

/** Fait converger la camera sur un cadrage, puis la rend. */
function settle(framing: ReturnType<typeof previewFraming>) {
  const camera = createArenaCamera(ASPECT);
  const rig = new ArenaCameraRig(camera);
  for (let i = 0; i < 900; i++) {
    rig.update({ framing, elapsed: 0, delta: 1 / 60, shake: 0, reducedMotion: true });
  }
  return camera;
}

/** Vrai si le point est dans le cadre, avec `slack` de marge normalisee. */
function inFrame(camera: ReturnType<typeof createArenaCamera>, point: Vector3, slack = 0): boolean {
  const projected = point.clone().project(camera);
  return (
    Math.abs(projected.x) <= 1 + slack && Math.abs(projected.y) <= 1 + slack && projected.z < 1
  );
}

/**
 * Le volume reellement occupe, articulation par articulation.
 *
 * Pas la boite englobante : celle du salto arriere a des coins ou le
 * personnage ne passe jamais, et exiger qu ils tiennent dans l image
 * reculerait la camera pour rien. On prend les positions vraies, gonflees de
 * la marge de volume — c est exactement ce que le rig dessinera.
 */
function volumeOf(animation: Animation, samples: number, worldX: number): Vector3[] {
  const points: Vector3[] = [];
  const m = LIMB_MARGIN;
  forEachWorldJoint(animation, samples, (x, y, z) => {
    points.push(
      new Vector3(worldX + x + m, y, z),
      new Vector3(worldX + x - m, y, z),
      new Vector3(worldX + x, y + m, z),
      // Jamais sous la plateforme : le rig borne l elevation a zero, et un
      // pied pose n a pas dix-huit centimetres de volume sous la semelle.
      new Vector3(worldX + x, Math.max(0, y - m), z),
      new Vector3(worldX + x, y, z + m),
      new Vector3(worldX + x, y, z - m),
    );
  });
  return points;
}

describe('distanceForHeight', () => {
  it('recule quand le sujet grandit', () => {
    expect(distanceForHeight(2, 0.8)).toBeGreaterThan(distanceForHeight(1, 0.8));
  });

  it('recule quand on veut laisser plus d air autour du sujet', () => {
    expect(distanceForHeight(1.7, 0.6)).toBeGreaterThan(distanceForHeight(1.7, 0.9));
  });

  it('recule du rayon du sujet, pour qu il tienne aussi vu de cote', () => {
    // Un membre tendu vers la camera est plus pres que l axe, donc plus gros :
    // sans ce recul, il sort du cadre des que le joueur tourne autour.
    expect(distanceForHeight(1.7, 0.8, 0.5)).toBeCloseTo(distanceForHeight(1.7, 0.8) + 0.5, 6);
  });

  it('borne la distance des deux cotes', () => {
    // Sans plancher, un sujet minuscule mettrait la camera dans le crane ;
    // sans plafond, un sujet aberrant l enverrait dans les gradins.
    expect(distanceForHeight(0.01, 0.8)).toBeCloseTo(1.2, 6);
    expect(distanceForHeight(60, 0.8)).toBeCloseTo(7, 6);
  });
});

describe('previewFraming', () => {
  it('vise le milieu du sujet et se place a sa hauteur', () => {
    const bounds = boundsOf('anim.calme.t0.crossed');
    const framing = previewFraming({ worldX: 0.4, bounds });
    expect(framing.lookX).toBe(0.4);
    expect(framing.lookY).toBeCloseTo((bounds.maxY + bounds.minY) / 2, 6);
    // Pas de contre-plongee dans la vitrine : on inspecte un geste, on ne le
    // domine pas. C est justement ce que `eyeY` permet de dire.
    expect(framing.eyeY).toBeCloseTo(framing.lookY, 6);
  });

  it('recule pour le salto arriere et se rapproche pour une pose debout', () => {
    const flip = previewFraming({ worldX: 0, bounds: boundsOf('anim.calme.t4.backflip') });
    const still = previewFraming({ worldX: 0, bounds: boundsOf('anim.calme.t0.crossed') });
    expect(flip.distance).toBeGreaterThan(still.distance + 0.5);
  });

  it('cadre le buste plus pres et plus haut que le corps entier', () => {
    const bounds = boundsOf('anim.provoc.t2.mewing');
    const body = previewFraming({ worldX: 0, bounds });
    const bust = previewFraming({ worldX: 0, bounds, shot: 'bust' });
    expect(bust.distance).toBeLessThan(body.distance);
    expect(bust.lookY).toBeGreaterThan(body.lookY);
    // Le plan rapproche part sous le bassin : la tete tient largement dedans.
    expect(bust.lookY).toBeGreaterThan(bounds.hipY);
  });

  it('transmet l orbite demandee par le joueur', () => {
    const bounds = boundsOf('anim.hype.t0.dab');
    expect(previewFraming({ worldX: 0, bounds, orbit: 1.2 }).orbit).toBeCloseTo(1.2, 10);
    expect(previewFraming({ worldX: 0, bounds }).orbit).toBe(0);
  });

  it('eleve la camera avec l inclinaison, sans jamais passer sous la plateforme', () => {
    const bounds = boundsOf('anim.calme.t0.crossed');
    const neutral = previewFraming({ worldX: 0, bounds });
    expect(previewFraming({ worldX: 0, bounds, tilt: 0.5 }).eyeY).toBeGreaterThan(
      neutral.eyeY ?? 0,
    );
    // Meme avec une demande absurde, la camera reste au-dessus du sol et sous
    // un plafond raisonnable : pas de vue a travers le plancher, pas de
    // plongee qui ecrase la silhouette.
    expect(previewFraming({ worldX: 0, bounds, tilt: -40 }).eyeY).toBeGreaterThan(0.3);
    expect(previewFraming({ worldX: 0, bounds, tilt: 40 }).eyeY).toBeLessThan(bounds.maxY + 1);
  });

  it('ne colle jamais la camera au personnage, meme sur un sujet minuscule', () => {
    const flat: AnimationBounds = { radius: 0.2, minY: 1, maxY: 1, headY: 1, hipY: 1 };
    const framing = previewFraming({ worldX: 0, bounds: flat });
    expect(framing.distance).toBeGreaterThanOrEqual(1.2);
    expect(Number.isFinite(framing.lookY)).toBe(true);
  });
});

describe('chaque meme livre tient dans le cadre', () => {
  /**
   * Le critere d acceptation du jalon : la camera ne coupe pas les pieds.
   *
   * On projette les huit coins de l encombrement mesure avec la vraie camera,
   * apres convergence. Un cadrage trop serre se voit ici, pas sur le telephone
   * d un joueur.
   */
  it('de face, silhouette entiere dans l image', () => {
    for (const animation of all) {
      const bounds = animationBounds(animation);
      const framing = previewFraming({ worldX: 0, bounds, shot: animation.framing?.shot });
      const camera = settle(framing);
      for (const point of volumeOf(animation, 24, 0)) {
        // Un plan rapproche coupe volontairement sous le bassin : on ne lui
        // demande que de garder la tete et les mains.
        if (animation.framing?.shot === 'bust' && point.y < bounds.hipY) continue;
        expect(inFrame(camera, point), `${animation.id} @ ${point.toArray().join()}`).toBe(true);
      }
    }
  });

  /**
   * Le delai est explicite parce que ce test grandit avec le catalogue.
   *
   * Il croise chaque animation livree avec chaque angle d orbite et chaque
   * inclinaison : passer de 21 a 33 memes l a fait depasser les cinq secondes
   * par defaut, sous charge parallele. Ce n est pas une lenteur a corriger,
   * c est une couverture qui augmente — et l echantillonnage ne doit pas etre
   * rabote pour rentrer dans un delai arbitraire.
   */
  it('sous n importe quel angle d orbite et d inclinaison', { timeout: 30_000 }, () => {
    // Le joueur peut tourner autour et lever la camera : le geste doit rester
    // lisible de dos et de trois quarts, pas seulement de face.
    for (const animation of all) {
      const bounds = animationBounds(animation);
      const shot = animation.framing?.shot;
      const points = volumeOf(animation, 8, 0);
      for (const orbit of [-Math.PI, -1.2, 0, 1.2, Math.PI / 2]) {
        for (const tilt of [-0.5, 0, 0.9]) {
          const camera = settle(previewFraming({ worldX: 0, bounds, shot, orbit, tilt }));
          for (const point of points) {
            if (shot === 'bust' && point.y < bounds.hipY) continue;
            expect(
              inFrame(camera, point),
              `${animation.id} orbite=${String(orbit)} inclinaison=${String(tilt)}`,
            ).toBe(true);
          }
        }
      }
    }
  });

  it('garde la camera au-dessus de la plateforme a tout moment', () => {
    for (const animation of all) {
      const bounds = animationBounds(animation);
      for (const tilt of [-0.5, 0, 0.9]) {
        const framing = previewFraming({
          worldX: 0,
          bounds,
          shot: animation.framing?.shot,
          tilt,
        });
        const camera = settle(framing);
        // Le dessus de la plateforme est a y = 0 : en dessous, on verrait le
        // personnage par en dessous, a travers le sol.
        expect(camera.position.y, `${animation.id} @ ${String(tilt)}`).toBeGreaterThan(0.2);
      }
    }
  });
});

describe('ArenaCameraRig et les rotations rapides', () => {
  /**
   * Regression : la camera prenait la corde au lieu de l arc.
   *
   * Le portage initial amortissait `x` et `z` separement. Sur une rotation
   * lente — la seule que le match produisait — cela ne se voyait pas ; des que
   * le joueur fait tourner son personnage, la camera coupe le virage et le
   * rayon s effondre de moitie. L angle et la distance sont donc suivis
   * separement, puis recomposes.
   */
  it('garde son rayon quand l orbite tourne vite', () => {
    const bounds = boundsOf('anim.calme.t0.crossed');
    const camera = createArenaCamera(ASPECT);
    const rig = new ArenaCameraRig(camera);
    const base = previewFraming({ worldX: 0, bounds });

    // Deux secondes a trois radians par seconde : presque un tour complet.
    let worst = Number.POSITIVE_INFINITY;
    for (let i = 0; i < 240; i++) {
      const orbit = (i / 60) * 3;
      rig.update({
        framing: previewFraming({ worldX: 0, bounds, orbit }),
        elapsed: 0,
        delta: 1 / 60,
        shake: 0,
        reducedMotion: true,
      });
      // On laisse une demi-seconde a la distance pour converger.
      if (i > 30) worst = Math.min(worst, Math.hypot(camera.position.x, camera.position.z));
    }
    expect(worst).toBeGreaterThan(base.distance * 0.95);
  });

  it('fait vraiment le tour : dos, profil, face', () => {
    const bounds = boundsOf('anim.calme.t0.crossed');
    const back = settle(previewFraming({ worldX: 0, bounds, orbit: Math.PI }));
    const side = settle(previewFraming({ worldX: 0, bounds, orbit: Math.PI / 2 }));
    const front = settle(previewFraming({ worldX: 0, bounds, orbit: 0 }));
    expect(back.position.z).toBeLessThan(0);
    expect(front.position.z).toBeGreaterThan(0);
    expect(Math.abs(side.position.z)).toBeLessThan(0.05);
    expect(side.position.x).toBeGreaterThan(1);
  });
});
