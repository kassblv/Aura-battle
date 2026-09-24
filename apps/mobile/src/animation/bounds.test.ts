import { describe, expect, it } from 'vitest';
import { ANIMATIONS } from '../content/animations.js';
import { animationBounds } from './bounds.js';

/** Les 26 animations livrees, par identifiant. */
const all = [...ANIMATIONS.values()];

function boundsOf(id: string) {
  const animation = ANIMATIONS.get(id);
  if (animation === undefined) throw new Error(`animation ${id} absente`);
  return animationBounds(animation);
}

/** Poses tenues la tete en bas l essentiel de leur boucle. */
const INVERTED_BY_DESIGN: ReadonlySet<string> = new Set(['anim.prouesse.t3.handstand']);

describe('animationBounds', () => {
  it('mesure toutes les animations sans produire de borne aberrante', () => {
    for (const animation of all) {
      const b = animationBounds(animation);
      for (const [name, value] of Object.entries(b)) {
        expect(Number.isFinite(value), `${animation.id}.${name}`).toBe(true);
      }
      expect(b.maxY, animation.id).toBeGreaterThan(b.minY);
      expect(b.radius, animation.id).toBeGreaterThan(0);
      // Le bassin est sous la tete dans toutes les poses, salto compris : au
      // milieu d un salto les deux tournent ensemble, et la moyenne sur la
      // boucle garde l ordre. Sauf une pose qui passe l essentiel de sa boucle
      // a l envers PAR CONSTRUCTION : l y exiger reviendrait a interdire le
      // poirier, pas a detecter une erreur de repere.
      if (INVERTED_BY_DESIGN.has(animation.id)) {
        expect(b.headY, animation.id).toBeLessThan(b.hipY);
        continue;
      }
      expect(b.headY, animation.id).toBeGreaterThan(b.hipY);
    }
  });

  it('est pure : deux mesures de la meme animation sont identiques', () => {
    for (const animation of all.slice(0, 5)) {
      expect(animationBounds(animation)).toEqual(animationBounds(animation));
    }
  });

  it('donne a un personnage debout la taille d un personnage debout', () => {
    const b = boundsOf('anim.calme.t0.crossed');
    // Les pieds au sol, la tete a un metre et demi — plus la marge de volume.
    expect(b.minY).toBe(0);
    expect(b.maxY).toBeGreaterThan(1.55);
    expect(b.maxY).toBeLessThan(1.85);
    expect(b.headY).toBeGreaterThan(1.4);
    expect(b.headY).toBeLessThan(1.6);
  });

  /**
   * Le salto arriere est le cas qui justifie la mesure.
   *
   * Il monte de presque un metre et tourne autour du pivot du rig : cadre
   * comme une pose debout, le personnage sort du haut de l image.
   */
  it('voit que le salto arriere occupe bien plus de hauteur qu une pose debout', () => {
    const flip = boundsOf('anim.acrobatie.t4.backflip');
    const still = boundsOf('anim.calme.t0.crossed');
    expect(flip.maxY).toBeGreaterThan(still.maxY + 0.6);
  });

  it('voit que la levitation decolle du sol', () => {
    // `float` leve la racine : les pieds ne touchent plus le plancher.
    expect(boundsOf('anim.calme.t4.levitate').minY).toBeGreaterThan(0.1);
    expect(boundsOf('anim.calme.t0.crossed').minY).toBe(0);
  });

  /**
   * Le piege de ce portage : la T-pose tend ses bras en profondeur.
   *
   * Ses articulations tiennent toutes dans six centimetres de large, et c est
   * `z` qui porte les 46 cm de chaque cote. Une mesure qui l ignorerait la
   * trouverait deux fois plus etroite que des bras croises.
   */
  it('voit que la T-pose est la pose la plus encombrante, bras en profondeur', () => {
    const tpose = boundsOf('anim.provoc.t1.tpose');
    const crossed = boundsOf('anim.calme.t0.crossed');
    expect(tpose.radius).toBeGreaterThan(crossed.radius);
    expect(tpose.radius).toBeGreaterThan(0.6);
  });

  /**
   * L interpolation Catmull-Rom **deborde** des images cles : ne mesurer que
   * les images cles sous-estimerait l amplitude, et le debordement sortirait
   * du cadre. Comme les huit instants sont un sous-ensemble des soixante-quatre,
   * la mesure fine ne peut que contenir la grossiere.
   */
  it('trouve davantage d amplitude en echantillonnant plus finement', () => {
    for (const animation of all) {
      const coarse = animationBounds(animation, 8);
      const fine = animationBounds(animation, 64);
      expect(fine.maxY, animation.id).toBeGreaterThanOrEqual(coarse.maxY - 1e-9);
      expect(fine.minY, animation.id).toBeLessThanOrEqual(coarse.minY + 1e-9);
      expect(fine.radius, animation.id).toBeGreaterThanOrEqual(coarse.radius - 1e-9);
    }
  });

  it('ne se noie pas sur une demande d echantillonnage absurde', () => {
    const animation = ANIMATIONS.get('anim.calme.t0.crossed')!;
    expect(() => animationBounds(animation, 0)).not.toThrow();
    expect(Number.isFinite(animationBounds(animation, 0).maxY)).toBe(true);
  });
});
