import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import { loadPrototypeData, type PrototypeData } from '../tools/prototype-source.js';
import { loadAnimation, type Animation } from './animation.js';
import { allAnimationIds, animationsFor, STYLES, SYSTEM_ANIMATIONS, TIERS } from './catalogue.js';
import { createAnimationValidator } from './validate.js';

const animationsRoot = fileURLToPath(new URL('../animations/', import.meta.url));
const prototypePath = fileURLToPath(
  new URL('../../../prototype/aura-battle.html', import.meta.url),
);

const schema: object = JSON.parse(
  readFileSync(fileURLToPath(new URL('../schema/animation.schema.json', import.meta.url)), 'utf8'),
) as object;

function loadAll(): Map<string, Animation> {
  const animations = new Map<string, Animation>();
  for (const style of readdirSync(animationsRoot)) {
    for (const file of readdirSync(`${animationsRoot}${style}`)) {
      // `loadAnimation` plutot qu'un cast : les 26 fichiers livres doivent
      // passer le portier que le client utilisera, sinon le type ment.
      const animation = loadAnimation(
        JSON.parse(readFileSync(`${animationsRoot}${style}/${file}`, 'utf8')),
      );
      animations.set(file.replace('.json', ''), animation);
    }
  }
  return animations;
}

const animations = loadAll();
const validate = createAnimationValidator(schema);

describe('animations portees', () => {
  it('produit un fichier par entree du catalogue, ni plus ni moins', () => {
    expect([...animations.keys()].sort()).toEqual(
      [
        ...STYLES.flatMap((style) => TIERS.flatMap((tier) => animationsFor({ style, tier }))),
        ...SYSTEM_ANIMATIONS,
      ].sort(),
    );
  });

  it('valide chaque animation contre le schema et les controles de coherence', () => {
    const invalides: string[] = [];
    for (const [slug, animation] of animations) {
      const result = validate(animation);
      if (!result.valid) {
        invalides.push(`${slug} : ${result.issues.map((issue) => issue.message).join(' | ')}`);
      }
    }
    expect(invalides).toEqual([]);
  });

  it('donne a chaque fichier l identifiant attendu par le catalogue', () => {
    const attendus = new Set(allAnimationIds());
    for (const animation of animations.values()) {
      expect(attendus).toContain(animation.id);
    }
  });

  it('offre exactement une animation par defaut pour chaque mouvement', () => {
    for (const style of STYLES) {
      for (const tier of TIERS) {
        const slugs = animationsFor({ style, tier });
        const defauts = slugs.filter((slug) => animations.get(slug)?.rarity === 'default');
        expect(defauts).toEqual([slugs[0]]);
      }
    }
  });

  it('range les animations systeme hors des mouvements jouables', () => {
    for (const slug of SYSTEM_ANIMATIONS) {
      expect(animations.get(slug)?.move).toEqual({ style: 'system', tier: null });
    }
  });
});

describe('non-regression : les valeurs correspondent au prototype', () => {
  let prototype: PrototypeData;

  beforeAll(async () => {
    prototype = await loadPrototypeData(prototypePath);
  });

  it('reproduit la premiere image de chaque animation de mouvement', () => {
    const ecarts: string[] = [];
    for (const style of STYLES) {
      for (const tier of TIERS) {
        for (const slug of animationsFor({ style, tier })) {
          const porte = animations.get(slug)!.frames[0]!.joints;
          const source = prototype.APOSE[slug]!.frames[0] as unknown as Record<
            string,
            [number, number]
          >;
          for (const [joint, [x, y]] of Object.entries(porte)) {
            const reference = source[joint];
            if (reference === undefined) {
              ecarts.push(`${slug}.${joint} absent du prototype`);
              continue;
            }
            if (Math.abs(x - reference[0]) > 0.01 || Math.abs(y - reference[1]) > 0.01) {
              ecarts.push(`${slug}.${joint} : [${x}, ${y}] contre [${reference.join(', ')}]`);
            }
          }
        }
      }
    }
    expect(ecarts).toEqual([]);
  });

  it('reproduit la duree de boucle de chaque animation de mouvement', () => {
    for (const style of STYLES) {
      for (const tier of TIERS) {
        for (const slug of animationsFor({ style, tier })) {
          const porte = animations.get(slug) as unknown as { loop: { duration: number } };
          expect(porte.loop.duration).toBe(prototype.APOSE[slug]!.dur);
        }
      }
    }
  });

  it('reproduit le nombre d images de chaque animation de mouvement', () => {
    for (const style of STYLES) {
      for (const tier of TIERS) {
        for (const slug of animationsFor({ style, tier })) {
          expect(animations.get(slug)!.frames).toHaveLength(prototype.APOSE[slug]!.frames.length);
        }
      }
    }
  });

  it('reproduit les poses systeme figees', () => {
    for (const slug of ['charge', 'land', 'stagger']) {
      const porte = animations.get(slug)!.frames[0]!.joints;
      const source = prototype.PTS[slug] as unknown as Record<string, [number, number]>;
      for (const [joint, [x, y]] of Object.entries(porte)) {
        expect(x).toBeCloseTo(source[joint]![0], 2);
        expect(y).toBeCloseTo(source[joint]![1], 2);
      }
    }
  });
});
