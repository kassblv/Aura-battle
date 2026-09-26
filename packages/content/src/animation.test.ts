import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { JOINT_NAMES, loadAnimation, type Animation } from './animation.js';

const schema = JSON.parse(
  readFileSync(fileURLToPath(new URL('../schema/animation.schema.json', import.meta.url)), 'utf8'),
) as { $defs: { frame: { properties: { joints: { required: string[] } } } } };

describe('type des animations', () => {
  /**
   * Le schema valide a l'execution, le type valide a la compilation. S'ils
   * divergent, un consommateur compile sans erreur contre une forme que la
   * validation refuse — ou l'inverse. Ce test les tient ensemble.
   */
  it('nomme exactement les articulations que le schema exige', () => {
    expect([...JOINT_NAMES].sort()).toEqual(
      [...schema.$defs.frame.properties.joints.required].sort(),
    );
  });
});

describe('loadAnimation', () => {
  const griddy = {
    id: 'anim.hype.t3.griddy',
    version: 1,
    name: { fr: 'Griddy' },
    icon: '🐾',
    move: { style: 'hype', tier: 3 },
    loop: { duration: 0.62 },
    hands: [
      ['fist', 'in'],
      ['fist', 'in'],
    ],
    frames: [{ joints: Object.fromEntries(JOINT_NAMES.map((j) => [j, [0, 0]])) }],
  };

  it('rend un document typé quand il est conforme', () => {
    const animation: Animation = loadAnimation(griddy);
    expect(animation.id).toBe('anim.hype.t3.griddy');
    expect(animation.frames).toHaveLength(1);
  });

  /**
   * Le type ne protege que la compilation. Une animation vient d'un fichier,
   * donc potentiellement d'une main humaine ou d'un telechargement : la forme
   * doit etre verifiee au chargement, pas supposee.
   */
  it('refuse un document qui n est pas une animation', () => {
    expect(() => loadAnimation({ id: 'x' })).toThrow(/animation/i);
    expect(() => loadAnimation(null)).toThrow(/animation/i);
  });

  /**
   * Le nom francais est ce que le joueur lit dans la galerie de memes.
   *
   * Sans cette verification, une danse peut arriver anonyme : elle se charge,
   * se joue, se vend — et s'affiche sans nom, sans que rien n'ait proteste.
   * Regle d'or n°5 : ajouter une danse doit etre sur, donc le fichier doit
   * porter tout ce dont l'ecran a besoin.
   */
  it('refuse une animation sans nom francais', () => {
    expect(() => loadAnimation({ ...griddy, name: {} })).toThrow(/nom/i);
    expect(() => loadAnimation({ ...griddy, name: { en: 'Griddy' } })).toThrow(/nom/i);
    expect(() => loadAnimation({ ...griddy, name: { fr: '   ' } })).toThrow(/nom/i);
  });

  /*
    Le pictogramme est ce que la carte de pose montre en duel (chantier n°2).
    Une pose sans pictogramme arriverait en main comme une carte blanche.
  */
  it('refuse une pose de mouvement sans pictogramme', () => {
    const { icon: _icon, ...sansIcone } = griddy;
    expect(() => loadAnimation(sansIcone)).toThrow(/pictogramme/i);
    expect(() => loadAnimation({ ...griddy, icon: '  ' })).toThrow(/pictogramme/i);
  });

  it('n exige pas de pictogramme pour une animation systeme', () => {
    const { icon: _icon, ...sansIcone } = griddy;
    const victoire = {
      ...sansIcone,
      id: 'anim.system.none.victory',
      move: { style: 'system', tier: null },
    };
    expect(loadAnimation(victoire).icon).toBeUndefined();
  });

  it('refuse une image a laquelle il manque une articulation', () => {
    const joints = Object.fromEntries(JOINT_NAMES.slice(1).map((j) => [j, [0, 0]]));
    expect(() => loadAnimation({ ...griddy, frames: [{ joints }] })).toThrow(/head/);
  });

  it('nomme l animation fautive dans l erreur', () => {
    expect(() => loadAnimation({ ...griddy, frames: [] })).toThrow(/anim\.hype\.t3\.griddy/);
  });
});
