import { InstancedMesh, Matrix4, Quaternion, Texture, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { createCrowd, CROWD_SIZE } from './crowd.js';
import { buildSeats, RING_SIZE } from './crowdLayout.js';
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

const build = () => createCrowd({ gradientMap, glow: new Texture() }, seeded(7));

function instancesOf(crowd: ReturnType<typeof createCrowd>): InstancedMesh[] {
  return crowd.group.children.filter((c): c is InstancedMesh => c instanceof InstancedMesh);
}

function part(crowd: ReturnType<typeof createCrowd>, name: string): InstancedMesh {
  const found = instancesOf(crowd).find((m) => m.name === name);
  if (found === undefined) throw new Error(`${name} absent de la foule`);
  return found;
}

function positionAt(mesh: InstancedMesh, index: number): Vector3 {
  const matrix = new Matrix4();
  const position = new Vector3();
  mesh.getMatrixAt(index, matrix);
  matrix.decompose(position, new Quaternion(), new Vector3());
  return position;
}

/**
 * Echelle lue **sur les colonnes** de la matrice, pas par `decompose`.
 *
 * `Matrix4.decompose` releve une echelle de 1 sur une matrice d echelle nulle
 * — il se protege de la division par zero avant de rendre le resultat. Or une
 * echelle nulle est exactement la facon dont on efface une instance : un test
 * ecrit avec `decompose` ne verrait jamais la difference entre effacee et
 * presente.
 */
function scaleAt(mesh: InstancedMesh, index: number): number {
  const matrix = new Matrix4();
  mesh.getMatrixAt(index, matrix);
  const [xx = 0, xy = 0, xz = 0] = matrix.elements;
  return Math.hypot(xx, xy, xz);
}

describe('createCrowd', () => {
  it('dessine chaque partie du corps en une seule fois', () => {
    const crowd = build();
    const meshes = instancesOf(crowd);
    // Buste, tete, coiffure, deux bras, telephone, halo d ecran : sept appels
    // de dessin pour deux cent dix personnes, la ou deux cent dix groupes en
    // couteraient des milliers.
    expect(meshes).toHaveLength(7);
    expect(meshes.map((m) => m.name).sort()).toEqual(
      ['armLeft', 'armRight', 'body', 'hair', 'head', 'phone', 'screen'].sort(),
    );
    for (const name of ['body', 'head', 'hair', 'armLeft', 'armRight']) {
      expect(part(crowd, name).count).toBe(CROWD_SIZE);
    }
    crowd.dispose();
  });

  /**
   * Les silhouettes du premier plan ne coutent aucun appel de dessin : ce sont
   * des places comme les autres dans les memes `InstancedMesh`. C est tout
   * l interet de les avoir mises la.
   */
  it('loge le premier plan dans les memes instances que la tribune', () => {
    const crowd = build();
    expect(part(crowd, 'body').count).toBe(CROWD_SIZE);
    expect(instancesOf(crowd)).toHaveLength(7);
    crowd.dispose();
  });

  /** Un telephone par spectateur qui filme, et pas une instance de plus. */
  it('n instancie que les telephones reellement tenus', () => {
    const crowd = build();
    const filming = buildSeats(seeded(7)).filter((s) => s.filming).length;
    expect(filming).toBeGreaterThan(0);
    expect(filming).toBeLessThan(CROWD_SIZE);
    expect(part(crowd, 'phone').count).toBe(filming);
    expect(part(crowd, 'screen').count).toBe(filming);
    crowd.dispose();
  });

  it('donne une carrure a chacun, et une coiffure a ceux qui en ont une', () => {
    const crowd = build();
    const seats = buildSeats(seeded(7));
    crowd.update(0, 0.3);
    const body = part(crowd, 'body');
    const widths = seats.map((_, i) => scaleAt(body, i) / seats[i]!.scale);
    expect(Math.max(...widths) - Math.min(...widths)).toBeGreaterThan(0.25);

    const hair = part(crowd, 'hair');
    seats.forEach((seat, i) => {
      if (seat.ring) return;
      if (seat.headWear === 'bald') expect(scaleAt(hair, i)).toBe(0);
      else expect(scaleAt(hair, i)).toBeGreaterThan(0.9);
    });
    crowd.dispose();
  });

  it('fait hocher les tetes', () => {
    const crowd = build();
    const head = part(crowd, 'head');
    const tilt = (): Quaternion => {
      const matrix = new Matrix4();
      head.getMatrixAt(RING_SIZE + 3, matrix);
      const rotation = new Quaternion();
      matrix.decompose(new Vector3(), rotation, new Vector3());
      return rotation;
    };
    crowd.update(0.1, 0.8);
    const before = tilt();
    crowd.update(0.5, 0.8);
    expect(before.angleTo(tilt())).toBeGreaterThan(0.02);
    crowd.dispose();
  });

  it('donne une couleur propre a chaque spectateur et a chaque ecran', () => {
    const crowd = build();
    for (const name of ['body', 'head', 'hair', 'armLeft', 'armRight', 'screen']) {
      expect(part(crowd, name).instanceColor).not.toBeNull();
    }
    crowd.dispose();
  });

  it('leve les bras quand la ferveur monte', () => {
    const crowd = build();
    const arm = part(crowd, 'armLeft');
    crowd.update(0, 0);
    const calm = positionAt(arm, 0).y;
    crowd.update(0, 1);
    expect(positionAt(arm, 0).y).toBeGreaterThan(calm);
    crowd.dispose();
  });

  /**
   * Le telephone se tient au bout du bras, pas a cote du corps. Le portage
   * initial accrochait le baton lumineux a une hauteur calculee a part : il
   * flottait a cote d une main qui ne le tenait pas.
   */
  it('tient le telephone au bout du bras qui le brandit', () => {
    const crowd = build();
    crowd.update(0, 1);
    const seats = buildSeats(seeded(7));
    const index = seats.findIndex((s) => s.filming && !s.ring);
    const slot = seats.slice(0, index).filter((s) => s.filming).length;

    const head = positionAt(part(crowd, 'head'), index);
    const phone = positionAt(part(crowd, 'phone'), slot);
    const screen = positionAt(part(crowd, 'screen'), slot);

    // A portee de main : au-dessus des epaules, sous le bras tendu.
    expect(phone.y).toBeGreaterThan(head.y - 0.25);
    expect(phone.y).toBeLessThan(head.y + 0.4);
    expect(Math.hypot(phone.x - head.x, phone.z - head.z)).toBeLessThan(0.6);
    // Le halo est pose juste devant l appareil, sinon les deux plans
    // se disputent la meme profondeur et scintillent.
    expect(screen.z).toBeGreaterThan(phone.z);
    crowd.dispose();
  });

  it('fait grossir le halo au moment de l eclat', () => {
    const crowd = build();
    const screen = part(crowd, 'screen');
    const sizes: number[] = [];
    for (let step = 0; step < 200; step++) {
      crowd.update(step * 0.05, 1);
      sizes.push(scaleAt(screen, 0));
    }
    expect(Math.max(...sizes)).toBeGreaterThan(Math.min(...sizes) * 1.3);
    crowd.dispose();
  });

  /**
   * Hors match on tourne autour d un seul personnage, jusqu a passer la camera
   * la ou ces gens-la se tiennent : ils masqueraient ce qu on vient inspecter.
   */
  it('efface le premier cercle dans la vitrine, et le remet en duel', () => {
    const crowd = build();
    const seats = buildSeats(seeded(7));
    const index = seats.findIndex((s) => s.ring);
    // Les places sont triees par importance : la premiere marche n est plus
    // la place zero, il faut la chercher.
    const stand = seats.findIndex((s) => !s.ring);
    expect(index).toBeGreaterThanOrEqual(0);
    expect(stand).toBeGreaterThanOrEqual(0);
    const body = part(crowd, 'body');

    crowd.update(0, 0.3, true);
    expect(scaleAt(body, index)).toBe(0);
    // La tribune, elle, reste : c est le fond de l ecran d accueil.
    expect(scaleAt(body, stand)).toBeGreaterThan(0);

    crowd.update(0, 0.3, false);
    expect(scaleAt(body, index)).toBeGreaterThan(0);
    crowd.dispose();
  });

  it('met le premier cercle a une echelle plus grande que les marches', () => {
    const crowd = build();
    const seats = buildSeats(seeded(7));
    const index = seats.findIndex((s) => s.ring);
    const stand = seats.findIndex((s) => !s.ring);
    crowd.update(0, 0.3);
    // La tete porte l echelle seule ; le buste y ajoute la carrure.
    expect(scaleAt(part(crowd, 'head'), index)).toBeGreaterThan(1.2);
    expect(scaleAt(part(crowd, 'head'), stand)).toBeCloseTo(1, 6);
    expect(seats.filter((s) => s.ring)).toHaveLength(RING_SIZE);
    crowd.dispose();
  });

  it('se reproduit a graine egale', () => {
    const one = build();
    const two = build();
    one.update(1.3, 0.5);
    two.update(1.3, 0.5);
    expect(positionAt(part(one, 'body'), 12).toArray()).toEqual(
      positionAt(part(two, 'body'), 12).toArray(),
    );
    one.dispose();
    two.dispose();
  });

  it('ne demande pas de mise a jour quand rien n a bouge', () => {
    const crowd = build();
    const body = part(crowd, 'body');
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

  /** Changer de vitrine doit redessiner, meme a instant et ferveur egaux. */
  it('redessine quand la vitrine s ouvre ou se ferme', () => {
    const crowd = build();
    const body = part(crowd, 'body');
    crowd.update(0.5, 0.2, false);
    const version = body.instanceMatrix.version;
    crowd.update(0.5, 0.2, true);
    expect(body.instanceMatrix.version).toBeGreaterThan(version);
    crowd.dispose();
  });

  it('supporte une double liberation', () => {
    const crowd = build();
    crowd.dispose();
    expect(() => crowd.dispose()).not.toThrow();
  });
});

describe('places dessinees', () => {
  /*
    Un palier de qualite plus bas ne reconstruit pas la foule : il baisse le
    `count` des instances, ce que Three.js lit a chaque image. Les places sont
    triees par importance (`crowdLayout`), donc couper la fin retire les
    derniers rangs et garde le premier cercle.
  */
  it('dessine toute la foule par defaut', () => {
    const crowd = build();
    expect(part(crowd, 'body').count).toBe(CROWD_SIZE);
  });

  it('coupe la fin de la liste, pas le premier cercle', () => {
    const crowd = build();
    crowd.setVisibleSeats(40);
    for (const name of ['body', 'head', 'armLeft', 'armRight']) {
      expect(part(crowd, name).count).toBe(40);
    }
    const seats = buildSeats(seeded(7));
    expect(seats.slice(0, 40).filter((s) => s.ring)).toHaveLength(RING_SIZE);
  });

  it('retire les telephones des places qu on ne dessine plus', () => {
    const crowd = build();
    const seats = buildSeats(seeded(7));
    const visible = 40;
    const filming = seats.slice(0, visible).filter((s) => s.filming).length;
    crowd.setVisibleSeats(visible);
    expect(part(crowd, 'phone').count).toBe(filming);
    expect(part(crowd, 'screen').count).toBe(filming);
  });

  it('ne descend jamais sous le premier cercle', () => {
    const crowd = build();
    crowd.setVisibleSeats(0);
    expect(part(crowd, 'body').count).toBe(RING_SIZE);
  });

  it('ne demande jamais plus de places qu il n en existe', () => {
    const crowd = build();
    crowd.setVisibleSeats(CROWD_SIZE * 10);
    expect(part(crowd, 'body').count).toBe(CROWD_SIZE);
  });

  it('redessine les places rendues quand le palier remonte', () => {
    const crowd = build();
    crowd.setVisibleSeats(40);
    crowd.setVisibleSeats(CROWD_SIZE);
    crowd.update(1, 0.5);
    expect(part(crowd, 'body').count).toBe(CROWD_SIZE);
    expect(positionAt(part(crowd, 'body'), CROWD_SIZE - 1).lengthSq()).toBeGreaterThan(0);
  });
});
