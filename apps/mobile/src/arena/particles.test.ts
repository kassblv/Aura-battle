import {
  AdditiveBlending,
  type BufferGeometry,
  NormalBlending,
  Points,
  type ShaderMaterial,
} from 'three';
import { describe, expect, it } from 'vitest';
import {
  ADDITIVE_CAPACITY,
  DARK_CAPACITY,
  createParticleFields,
  projectionScale,
  srgbComponents,
} from './particles.js';

function pointsOf(fields: ReturnType<typeof createParticleFields>): Points[] {
  return fields.group.children.filter((child): child is Points => child instanceof Points);
}

function geometryOf(fields: ReturnType<typeof createParticleFields>, name: string): BufferGeometry {
  const points = pointsOf(fields).find((child) => child.name === name);
  if (points === undefined) throw new Error(`tampon ${name} absent`);
  return points.geometry;
}

describe('createParticleFields', () => {
  it('dessine toutes les particules de l arene en deux appels', () => {
    const fields = createParticleFields();
    const points = pointsOf(fields);
    // Un sprite par particule couterait des centaines d appels de dessin :
    // c est le premier poste du budget mobile.
    expect(points).toHaveLength(2);
    expect(points.map((p) => p.name)).toEqual(['particles-dark', 'particles-additive']);
    fields.dispose();
  });

  it('melange la lumiere en additif et la fumee en normal', () => {
    const fields = createParticleFields();
    const [dark, additive] = pointsOf(fields);
    expect((additive?.material as ShaderMaterial).blending).toBe(AdditiveBlending);
    expect((dark?.material as ShaderMaterial).blending).toBe(NormalBlending);
    // La fumee passe avant la lumiere, sinon elle l efface.
    expect(dark?.renderOrder).toBeLessThan(additive?.renderOrder ?? 0);
    fields.dispose();
  });

  it('ne laisse pas le moteur ecarter le nuage du champ de vision', () => {
    // L englobant d un nuage qui change de forme a chaque image serait perime
    // en permanence : les particules disparaitraient par paquets.
    const fields = createParticleFields();
    for (const points of pointsOf(fields)) expect(points.frustumCulled).toBe(false);
    fields.dispose();
  });

  it('reserve ses tampons une fois pour toutes', () => {
    const fields = createParticleFields();
    const additive = geometryOf(fields, 'particles-additive');
    expect(additive.getAttribute('position').count).toBe(ADDITIVE_CAPACITY);
    expect(additive.getAttribute('acolor').itemSize).toBe(4);
    expect(geometryOf(fields, 'particles-dark').getAttribute('position').count).toBe(DARK_CAPACITY);
    fields.dispose();
  });

  it('ne dessine que les points poses depuis le dernier debut d image', () => {
    const fields = createParticleFields();
    fields.begin();
    fields.add(1, 2, 3, '#ffcf3f', 1, 0.05);
    fields.add(4, 5, 6, '#ffffff', 0.5, 0.02);
    fields.dark(0, 0, 0, '#07020f', 0.4, 0.1);
    fields.commit();

    expect(fields.counts).toEqual({ additive: 2, dark: 1 });
    expect(geometryOf(fields, 'particles-additive').drawRange.count).toBe(2);
    expect(geometryOf(fields, 'particles-dark').drawRange.count).toBe(1);

    // L image suivante repart de zero : rien ne survit d une image a l autre,
    // l etat des particules vit dans `aura.ts`.
    fields.begin();
    fields.commit();
    expect(fields.counts).toEqual({ additive: 0, dark: 0 });
    expect(geometryOf(fields, 'particles-additive').drawRange.count).toBe(0);
    fields.dispose();
  });

  it('ecrit position, couleur et taille au bon endroit', () => {
    const fields = createParticleFields();
    fields.begin();
    fields.add(1, 2, 3, '#ff8000', 0.75, 0.05);
    fields.commit();

    const geometry = geometryOf(fields, 'particles-additive');
    const position = geometry.getAttribute('position');
    expect([position.getX(0), position.getY(0), position.getZ(0)]).toEqual([1, 2, 3]);
    const color = geometry.getAttribute('acolor');
    expect(color.getX(0)).toBeCloseTo(1, 5);
    expect(color.getY(0)).toBeCloseTo(128 / 255, 5);
    expect(color.getZ(0)).toBe(0);
    expect(color.getW(0)).toBeCloseTo(0.75, 5);
    expect(geometry.getAttribute('size').getX(0)).toBeCloseTo(0.05, 5);
    fields.dispose();
  });

  it('jette les points invisibles plutot que de payer leur sommet', () => {
    const fields = createParticleFields();
    fields.begin();
    fields.add(0, 0, 0, '#ffffff', 0, 0.05);
    fields.add(0, 0, 0, '#ffffff', 0.002, 0.05);
    fields.commit();
    expect(fields.counts.additive).toBe(0);
    fields.dispose();
  });

  it('ignore ce qui deborde du tampon au lieu de l ecraser', () => {
    // Deborder en silence vaut mieux que corrompre le tampon ou lever en
    // pleine image : on perd des particules, pas la manche.
    const fields = createParticleFields();
    fields.begin();
    for (let i = 0; i < ADDITIVE_CAPACITY + 500; i++) {
      fields.add(0, 0, 0, '#ffffff', 1, 0.05);
    }
    fields.commit();
    expect(fields.counts.additive).toBe(ADDITIVE_CAPACITY);
    fields.dispose();
  });

  it('libere geometries et materiaux, et ne le fait qu une fois', () => {
    const fields = createParticleFields();
    const geometry = geometryOf(fields, 'particles-additive');
    let disposals = 0;
    geometry.addEventListener('dispose', () => {
      disposals += 1;
    });
    fields.dispose();
    fields.dispose();
    expect(disposals).toBe(1);
    expect(fields.group.children).toHaveLength(0);
  });

  it('transmet l echelle de projection aux deux tampons', () => {
    const fields = createParticleFields();
    fields.setProjectionScale(1234);
    for (const points of pointsOf(fields)) {
      expect((points.material as ShaderMaterial).uniforms.uScale?.value).toBe(1234);
    }
    fields.dispose();
  });
});

describe('projectionScale', () => {
  it('grandit avec la hauteur rendue et retrecit quand le champ s ouvre', () => {
    // Sans ce facteur, les particules du fond seraient aussi grosses que
    // celles du premier plan et l arene s aplatirait.
    expect(projectionScale(780, 2, 40)).toBeCloseTo(projectionScale(390, 2, 40) * 2, 6);
    expect(projectionScale(390, 2, 40)).toBeCloseTo(projectionScale(390, 1, 40) * 2, 6);
    expect(projectionScale(390, 1, 70)).toBeLessThan(projectionScale(390, 1, 40));
  });

  it('vaut la moitie de la hauteur a 53 degres, ou la tangente vaut 1/2', () => {
    const fov = (2 * Math.atan(0.5) * 180) / Math.PI;
    expect(projectionScale(1000, 1, fov)).toBeCloseTo(1000, 6);
  });
});

describe('srgbComponents', () => {
  /**
   * Volontairement sans gestion de couleur.
   *
   * Le fragment ecrit la valeur telle quelle dans un tampon deja en sRGB.
   * Passer par `Color` convertirait l hexadecimal en lineaire (Three.js
   * ≥ r152) sans que rien ne le reconvertisse : une aura or sortirait brune.
   */
  it('rend la couleur ecrite, sans conversion lineaire', () => {
    expect(srgbComponents('#ffffff')).toEqual([1, 1, 1]);
    expect(srgbComponents('#000000')).toEqual([0, 0, 0]);
    const gold = srgbComponents('#ffcf3f');
    expect(gold[0]).toBeCloseTo(1, 5);
    expect(gold[1]).toBeCloseTo(207 / 255, 5);
    expect(gold[2]).toBeCloseTo(63 / 255, 5);
  });

  it('renvoie la meme instance pour une couleur deja vue', () => {
    // Deux auras a fond convertissent des centaines de teintes par seconde.
    expect(srgbComponents('#4fe3ff')).toBe(srgbComponents('#4fe3ff'));
  });
});

describe('plafond d ecriture', () => {
  /** Remplit les deux tampons au-dela de toute limite plausible. */
  function flood(fields: ReturnType<typeof createParticleFields>, n: number): void {
    fields.begin();
    for (let i = 0; i < n; i++) {
      fields.add(0, 0, 0, '#ffffff', 1, 1);
      fields.dark(0, 0, 0, '#000000', 1, 1);
    }
    fields.commit();
  }

  it('ecrit jusqu a la pleine capacite par defaut', () => {
    const fields = createParticleFields();
    flood(fields, ADDITIVE_CAPACITY + 100);
    expect(fields.counts).toEqual({ additive: ADDITIVE_CAPACITY, dark: DARK_CAPACITY });
  });

  it('s arrete au plafond demande', () => {
    const fields = createParticleFields();
    fields.setLimits(10, 5);
    flood(fields, 500);
    expect(fields.counts).toEqual({ additive: 10, dark: 5 });
  });

  /*
    Le plafond est un levier de qualite : il change en plein match, a la
    frontiere d une manche. Il ne doit donc rien allouer ni rien liberer —
    c est le tampon deja en place qu on remplit moins.
  */
  it('ne realloue rien : le tampon garde sa taille', () => {
    const fields = createParticleFields();
    const before = geometryOf(fields, 'particles-additive').getAttribute('position').array.length;
    fields.setLimits(10, 5);
    const after = geometryOf(fields, 'particles-additive').getAttribute('position').array.length;
    expect(after).toBe(before);
    expect(after).toBe(ADDITIVE_CAPACITY * 3);
  });

  it('ne laisse pas depasser la capacite allouee', () => {
    const fields = createParticleFields();
    fields.setLimits(ADDITIVE_CAPACITY * 10, DARK_CAPACITY * 10);
    flood(fields, ADDITIVE_CAPACITY * 2);
    expect(fields.counts).toEqual({ additive: ADDITIVE_CAPACITY, dark: DARK_CAPACITY });
  });

  it('se rouvre quand le palier remonte', () => {
    const fields = createParticleFields();
    fields.setLimits(10, 5);
    fields.setLimits(ADDITIVE_CAPACITY, DARK_CAPACITY);
    flood(fields, ADDITIVE_CAPACITY + 100);
    expect(fields.counts).toEqual({ additive: ADDITIVE_CAPACITY, dark: DARK_CAPACITY });
  });
});
