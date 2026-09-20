import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { loadAnimation, type Animation } from './animation.js';
import { createAnimationValidator } from './validate.js';

/**
 * Le cadrage de previsualisation (`framing`), vu du paquet de contenu.
 *
 * Le champ ne sert que la vitrine de l accueil, mais il vit dans le fichier
 * d animation : ajouter une danse qui se joue au visage ne doit demander
 * aucun changement de code (regle d or n°5).
 */

const animationsRoot = fileURLToPath(new URL('../animations/', import.meta.url));
const packageSchemaPath = fileURLToPath(
  new URL('../schema/animation.schema.json', import.meta.url),
);
const docsSchemaPath = fileURLToPath(
  new URL('../../../docs/content/animation.schema.json', import.meta.url),
);

const schema: object = JSON.parse(readFileSync(packageSchemaPath, 'utf8')) as object;
const validate = createAnimationValidator(schema);

function loadAll(): Map<string, Animation> {
  const animations = new Map<string, Animation>();
  for (const style of readdirSync(animationsRoot)) {
    for (const file of readdirSync(`${animationsRoot}${style}`)) {
      const animation = loadAnimation(
        JSON.parse(readFileSync(`${animationsRoot}${style}/${file}`, 'utf8')),
      );
      animations.set(animation.id, animation);
    }
  }
  return animations;
}

const animations = loadAll();

/** Un document minimal mais complet, pour tester un champ a la fois. */
function document(framing?: unknown): Record<string, unknown> {
  const joints = {
    head: [0, -150],
    neck: [0, -132],
    hip: [0, -80],
    le: [-14, -106],
    lh: [-10, -84],
    re: [14, -106],
    rh: [10, -84],
    lk: [-8, -40],
    lf: [-10, 0],
    rk: [8, -40],
    rf: [10, 0],
  };
  const base: Record<string, unknown> = {
    id: 'anim.hype.t0.test',
    version: 1,
    name: { fr: 'Essai' },
    move: { style: 'hype', tier: 0 },
    loop: { duration: 1 },
    hands: [
      ['relax', 'in'],
      ['relax', 'in'],
    ],
    frames: [{ joints }],
  };
  if (framing !== undefined) base.framing = framing;
  return base;
}

describe('champ framing', () => {
  it('est optionnel : une animation sans cadrage reste valide', () => {
    expect(validate(document()).valid).toBe(true);
    expect(loadAnimation(document()).framing).toBeUndefined();
  });

  it('accepte les deux plans du vocabulaire', () => {
    for (const shot of ['body', 'bust'] as const) {
      expect(validate(document({ shot })).valid).toBe(true);
      expect(loadAnimation(document({ shot })).framing?.shot).toBe(shot);
    }
  });

  /**
   * Un cadrage mal orthographie doit etre rejete a la publication, pas
   * silencieusement ignore a l affichage : sinon l auteur croit avoir cadre sa
   * danse, et decouvre le contraire sur le telephone d un joueur.
   */
  it('refuse un plan inconnu, un champ en trop, ou un objet vide', () => {
    for (const bad of [
      { shot: 'face' },
      { shot: 'BODY' },
      { shot: 'body', zoom: 2 },
      {},
      'bust',
      null,
    ]) {
      expect(validate(document(bad)).valid, JSON.stringify(bad)).toBe(false);
    }
  });

  /**
   * Le portier du client est plus tolerant que celui de la publication, et
   * c est voulu (voir `loadAnimation`). Il refuse tout ce qui rend le cadrage
   * inutilisable, mais laisse passer un champ voisin qu il ne connait pas : un
   * catalogue plus recent que l application ne doit pas empecher de jouer.
   */
  it('refuse cote client un cadrage inutilisable, et tolere un champ inconnu', () => {
    for (const bad of [{ shot: 'face' }, { shot: 'BODY' }, {}, 'bust', null]) {
      expect(() => loadAnimation(document(bad)), JSON.stringify(bad)).toThrow();
    }
    expect(loadAnimation(document({ shot: 'body', zoom: 2 })).framing?.shot).toBe('body');
  });

  it('cadre au buste les memes qui se jouent au visage et aux mains', () => {
    const bust = [...animations.values()]
      .filter((animation) => animation.framing?.shot === 'bust')
      .map((animation) => animation.id)
      .sort();
    expect(bust).toEqual(
      [
        'anim.calme.t2.crown',
        'anim.calme.t2.lookaway',
        'anim.provoc.t3.dust',
        'anim.provoc.t3.lfront',
        'anim.provoc.t2.mewing',
        'anim.provoc.t0.shush',
        'anim.provoc.t2.slowclap',
      ].sort(),
    );
  });

  it('laisse tous les autres memes au cadrage automatique', () => {
    for (const animation of animations.values()) {
      const shot = animation.framing?.shot;
      expect(shot === undefined || shot === 'bust', animation.id).toBe(true);
    }
  });

  /**
   * Le schema existe en deux exemplaires : `docs/content` fait foi pour le
   * lecteur, `packages/content/schema` pour le validateur. Deux copies
   * derivent toujours — celle-ci a failli partir sans le champ `framing`, et
   * seul le CLI l aurait dit.
   */
  it('garde les deux copies du schema d accord', () => {
    const pkg: unknown = JSON.parse(readFileSync(packageSchemaPath, 'utf8'));
    const docs: unknown = JSON.parse(readFileSync(docsSchemaPath, 'utf8'));
    expect(pkg).toEqual(docs);
  });
});
