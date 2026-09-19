import { InstancedMesh, Matrix4, Quaternion, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { createCrowd, CROWD_SIZE } from './crowd.js';
import { createToonGradientMap } from './toonGradient.js';

const gradientMap = createToonGradientMap();

/** Generateur reproductible : deux foules de meme graine sont identiques. */
function seeded(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

const build = () => createCrowd({ gradientMap }, seeded(7));

function instancesOf(crowd: ReturnType<typeof createCrowd>): InstancedMesh[] {
  return crowd.group.children.filter((c): c is InstancedMesh => c instanceof InstancedMesh);
}

function positionAt(mesh: InstancedMesh, index: number): Vector3 {
  const matrix = new Matrix4();
  const position = new Vector3();
  mesh.getMatrixAt(index, matrix);
  matrix.decompose(position, new Quaternion(), new Vector3());
  return position;
}

describe('createCrowd', () => {
  it('dessine chaque partie du corps en une seule fois', () => {
    const crowd = build();
    const meshes = instancesOf(crowd);
    // Buste, tete, deux bras, baton lumineux : cinq appels de dessin pour
    // deux cents personnes, la ou deux cents groupes en couteraient des
    // milliers.
    expect(meshes).toHaveLength(5);
    expect(meshes.map((m) => m.name).sort()).toEqual(
      ['armLeft', 'armRight', 'body', 'glowstick', 'head'].sort(),
    );
    for (const mesh of meshes) expect(mesh.count).toBe(CROWD_SIZE);
    crowd.dispose();
  });

  it('donne une couleur propre a chaque spectateur', () => {
    const crowd = build();
    for (const mesh of instancesOf(crowd)) expect(mesh.instanceColor).not.toBeNull();
    crowd.dispose();
  });

  /**
   * Les spectateurs se tiennent sur les marches de `stage.ts`. Flottants, on
   * lit des gens suspendus au lieu d une tribune — et la profondeur du fond
   * disparait avec.
   */
  it('assied la foule sur les gradins, jamais dans le vide', () => {
    const crowd = build();
    const body = instancesOf(crowd).find((m) => m.name === 'body');
    if (body === undefined) throw new Error('buste absent');

    crowd.update(0, 0);
    for (let i = 0; i < CROWD_SIZE; i++) {
      const at = positionAt(body, i);
      const radius = Math.hypot(at.x, at.z);
      expect(radius).toBeGreaterThan(4.2);
      expect(radius).toBeLessThan(8.1);
      expect(at.y).toBeGreaterThan(0);
    }
    crowd.dispose();
  });

  /**
   * L arc des gradins est ouvert face a la camera : un public devant cacherait
   * le combat.
   */
  it('laisse la face avant de l arene libre', () => {
    const crowd = build();
    const body = instancesOf(crowd).find((m) => m.name === 'body');
    if (body === undefined) throw new Error('buste absent');

    crowd.update(0, 0);
    for (let i = 0; i < CROWD_SIZE; i++) {
      const at = positionAt(body, i);
      // Personne juste devant : ni proche de l axe, ni du cote de la camera.
      expect(at.z < 2.6 || Math.abs(at.x) > 3.4).toBe(true);
    }
    crowd.dispose();
  });

  /**
   * Les bras montent avec la ferveur. C est ce mouvement, et non la densite de
   * la foule, qui fait qu une tribune a l air vivante.
   */
  it('leve les bras quand la ferveur monte', () => {
    const crowd = build();
    const arm = instancesOf(crowd).find((m) => m.name === 'armLeft');
    if (arm === undefined) throw new Error('bras absent');

    crowd.update(0, 0);
    const calm = positionAt(arm, 0).y;
    crowd.update(0, 1);
    const roused = positionAt(arm, 0).y;
    expect(roused).toBeGreaterThan(calm);
    crowd.dispose();
  });

  it('fait sauter la foule, sans la decoller des gradins', () => {
    const crowd = build();
    const body = instancesOf(crowd).find((m) => m.name === 'body');
    if (body === undefined) throw new Error('buste absent');

    const heights: number[] = [];
    for (let step = 0; step < 40; step++) {
      crowd.update(step * 0.05, 1);
      heights.push(positionAt(body, 3).y);
    }
    const low = Math.min(...heights);
    const high = Math.max(...heights);
    expect(high - low).toBeGreaterThan(0.02);
    expect(high - low).toBeLessThan(0.4);
    crowd.dispose();
  });

  it('se reproduit a graine egale', () => {
    const one = build();
    const two = build();
    one.update(1.3, 0.5);
    two.update(1.3, 0.5);
    const bodyOne = instancesOf(one).find((m) => m.name === 'body');
    const bodyTwo = instancesOf(two).find((m) => m.name === 'body');
    if (bodyOne === undefined || bodyTwo === undefined) throw new Error('buste absent');
    expect(positionAt(bodyOne, 12).toArray()).toEqual(positionAt(bodyTwo, 12).toArray());
    one.dispose();
    two.dispose();
  });

  it('ne demande pas de mise a jour quand rien n a bouge', () => {
    const crowd = build();
    const body = instancesOf(crowd).find((m) => m.name === 'body');
    if (body === undefined) throw new Error('buste absent');
    crowd.update(0.5, 0.2);
    // `needsUpdate` est un setter seul : il ne se relit pas. C est `version`
    // qu il incremente, et c est donc elle qui dit si un televersement a ete
    // demande.
    const version = body.instanceMatrix.version;
    crowd.update(0.5, 0.2);
    // Meme instant, meme ferveur : reenvoyer deux cent dix matrices au GPU pour
    // rien est exactement ce qu une image a 60 Hz ne peut pas se permettre.
    expect(body.instanceMatrix.version).toBe(version);

    crowd.update(0.6, 0.2);
    expect(body.instanceMatrix.version).toBeGreaterThan(version);
    crowd.dispose();
  });
});
