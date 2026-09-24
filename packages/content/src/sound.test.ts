import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { loadAnimation, type Animation } from './animation.js';
import { createAnimationValidator } from './validate.js';

/**
 * Les accents sonores d une animation (`sound`).
 *
 * Meme principe que `framing` : le son d un geste est de la donnee, pas du
 * code. Ajouter une acrobatie qui claque au sol ne doit demander qu une ligne
 * dans son fichier (regle d or n°5).
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

function loadAll(): readonly Animation[] {
  const all: Animation[] = [];
  for (const style of readdirSync(animationsRoot)) {
    for (const file of readdirSync(`${animationsRoot}${style}`)) {
      all.push(
        loadAnimation(JSON.parse(readFileSync(`${animationsRoot}${style}/${file}`, 'utf8'))),
      );
    }
  }
  return all;
}

const animations = loadAll();

/** Un document minimal mais complet, pour tester un champ a la fois. */
function document(sound?: unknown): Record<string, unknown> {
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
    frames: [
      {
        joints: {
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
        },
      },
    ],
  };
  if (sound !== undefined) base.sound = sound;
  return base;
}

describe('champ sound', () => {
  it('est optionnel : une danse muette reste valide', () => {
    expect(validate(document()).valid).toBe(true);
    expect(loadAnimation(document()).sound).toBeUndefined();
  });

  it('accepte les trois accents du vocabulaire', () => {
    for (const accent of ['whoosh', 'impact', 'hold'] as const) {
      const doc = document([{ at: 0.4, accent }]);
      expect(validate(doc).valid, accent).toBe(true);
      expect(loadAnimation(doc).sound?.[0]?.accent).toBe(accent);
    }
  });

  it('refuse a la publication un accent inconnu, un instant hors boucle, un champ en trop', () => {
    for (const bad of [
      [{ at: 0.4, accent: 'boom' }],
      [{ at: 1, accent: 'impact' }],
      [{ at: -0.1, accent: 'impact' }],
      [{ at: 0.4, accent: 'impact', gain: 2 }],
      [{ at: 0.4 }],
      [{ accent: 'impact' }],
      { at: 0.4, accent: 'impact' },
    ]) {
      expect(validate(document(bad)).valid, JSON.stringify(bad)).toBe(false);
    }
  });

  /**
   * Le portier du client est plus tolerant que celui de la publication, et
   * c est voulu. Un instant hors de la boucle ne se joue jamais et une liste
   * qui n en est pas une fait planter la programmation : refuses. Un nom
   * d accent inconnu, lui, passe — un catalogue plus recent que l application
   * ne doit pas empecher de jouer, il doit juste rester silencieux.
   */
  it('refuse cote client ce qui est injouable, et tolere un accent qu il ne connait pas', () => {
    for (const bad of [
      [{ at: 1, accent: 'impact' }],
      [{ at: -0.1, accent: 'impact' }],
      [{}],
      'impact',
    ]) {
      expect(() => loadAnimation(document(bad)), JSON.stringify(bad)).toThrow();
    }
    expect(loadAnimation(document([{ at: 0.4, accent: 'rumble' }])).sound?.[0]?.accent).toBe(
      'rumble',
    );
  });

  it('range les accents dans la boucle de chaque animation livree', () => {
    for (const animation of animations) {
      for (const accent of animation.sound ?? []) {
        expect(accent.at, animation.id).toBeGreaterThanOrEqual(0);
        expect(accent.at, animation.id).toBeLessThan(1);
      }
    }
  });

  /**
   * Les acrobaties et les poses tenues sont exactement ce que le son doit
   * souligner : une roue qui retombe sans bruit ne pese rien a l ecran.
   */
  it('sonne les acrobaties, les prouesses et les poses tenues', () => {
    const accents = (id: string): readonly string[] =>
      (animations.find((animation) => animation.id === id)?.sound ?? []).map(
        (entry) => entry.accent,
      );
    expect(accents('anim.acrobatie.t2.wheel')).toEqual(['whoosh', 'impact']);
    expect(accents('anim.acrobatie.t4.backflip')).toEqual(['whoosh', 'impact']);
    expect(accents('anim.provoc.t2.slowclap')).toEqual(['impact', 'impact']);
    expect(accents('anim.calme.t2.crown')).toEqual(['hold']);
  });

  /** Deux copies du schema derivent toujours : celle-ci a failli partir sans `sound`. */
  it('garde les deux copies du schema d accord', () => {
    const pkg: unknown = JSON.parse(readFileSync(packageSchemaPath, 'utf8'));
    const docs: unknown = JSON.parse(readFileSync(docsSchemaPath, 'utf8'));
    expect(pkg).toEqual(docs);
  });
});
