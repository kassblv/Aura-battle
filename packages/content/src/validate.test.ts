import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { createAnimationValidator } from './validate.js';

const schema: object = JSON.parse(
  readFileSync(fileURLToPath(new URL('../schema/animation.schema.json', import.meta.url)), 'utf8'),
) as object;

const validate = createAnimationValidator(schema);

/** Squelette debout, proportions coherentes. Sert de base aux cas de test. */
const standing = {
  head: [0, -150],
  neck: [0, -132],
  hip: [0, -80],
  le: [-16, -110],
  lh: [-12, -86],
  re: [16, -110],
  rh: [12, -86],
  lk: [-8, -40],
  lf: [-12, 0],
  rk: [8, -40],
  rf: [12, 0],
};

const baseAnimation = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
  id: 'anim.calme.t0.test',
  version: 1,
  name: { fr: 'Test' },
  move: { style: 'calme', tier: 0 },
  rarity: 'default',
  loop: { duration: 2, weights: null, ease: false },
  flags: { expression: 'neutral' },
  hands: [
    ['relax', 'in'],
    ['relax', 'in'],
  ],
  frames: [{ joints: standing }],
  ...overrides,
});

describe('createAnimationValidator — schema', () => {
  it('accepte une animation minimale valide', () => {
    expect(validate(baseAnimation()).valid).toBe(true);
  });

  it('refuse un identifiant qui ne suit pas la convention', () => {
    expect(validate(baseAnimation({ id: 'dab' })).valid).toBe(false);
    expect(validate(baseAnimation({ id: 'anim.chill.t0.test' })).valid).toBe(false);
  });

  it('refuse une articulation manquante', () => {
    const { head: _omis, ...incomplet } = standing;
    const result = validate(baseAnimation({ frames: [{ joints: incomplet }] }));
    expect(result.valid).toBe(false);
    expect(result.issues.some((issue) => issue.message.includes('head'))).toBe(true);
  });

  it('refuse un champ inconnu', () => {
    expect(validate(baseAnimation({ power: 42 })).valid).toBe(false);
  });

  it('refuse une duree de boucle absurde', () => {
    expect(validate(baseAnimation({ loop: { duration: 0.1 } })).valid).toBe(false);
    expect(validate(baseAnimation({ loop: { duration: 60 } })).valid).toBe(false);
  });

  it('refuse une forme de main inconnue', () => {
    expect(
      validate(
        baseAnimation({
          hands: [
            ['griffe', 'in'],
            ['relax', 'in'],
          ],
        }),
      ).valid,
    ).toBe(false);
  });

  it('refuse un saut positif, qui enfoncerait le personnage dans le sol', () => {
    expect(validate(baseAnimation({ frames: [{ joints: standing, lift: 5 }] })).valid).toBe(false);
  });
});

describe('createAnimationValidator — coherence du squelette', () => {
  it('accepte un membre qui varie un peu, la perspective etant plate', () => {
    const legerementPlie = { ...standing, lh: [-12, -88] };
    expect(
      validate(baseAnimation({ frames: [{ joints: standing }, { joints: legerementPlie }] })).valid,
    ).toBe(true);
  });

  it('signale sans bloquer un membre raccourci par la perspective', () => {
    // 30 % plus court : frequent en 2D quand un bras pointe vers la camera.
    // Le prototype lui-meme le fait (dab, danse du bateau, poing leve).
    const brasRaccourci = { ...standing, lh: [-13.2, -93.2] };
    const result = validate(
      baseAnimation({
        frames: [{ joints: standing }, { joints: standing }, { joints: brasRaccourci }],
      }),
    );
    expect(result.valid).toBe(true);
    expect(result.warnings.some((issue) => issue.message.includes('longueur'))).toBe(true);
  });

  it('refuse un avant-bras qui s allonge de 70 %, ce qu aucune perspective n explique', () => {
    const brasEtire = { ...standing, lh: [-9.2, -69.2] };
    const result = validate(
      baseAnimation({
        frames: [{ joints: standing }, { joints: standing }, { joints: brasEtire }],
      }),
    );
    expect(result.valid).toBe(false);
    expect(result.errors.some((issue) => issue.message.includes('longueur'))).toBe(true);
  });

  it('refuse une rotation de corps hors du plausible', () => {
    const result = validate(baseAnimation({ frames: [{ joints: standing, rot: 42 }] }));
    expect(result.valid).toBe(false);
    expect(result.issues.some((issue) => issue.message.includes('rotation'))).toBe(true);
  });
});

describe('createAnimationValidator — boucle', () => {
  it('accepte une boucle reguliere', () => {
    const decale = (dx: number): Record<string, number[]> =>
      Object.fromEntries(Object.entries(standing).map(([key, [x, y]]) => [key, [x! + dx, y!]]));
    const result = validate(
      baseAnimation({
        frames: [{ joints: standing }, { joints: decale(4) }, { joints: decale(2) }],
      }),
    );
    expect(result.valid).toBe(true);
  });

  it('accepte le salto arriere, l animation la plus extreme du jeu', () => {
    // 63,5 cm de deplacement moyen : legitime, et c'est le maximum reel.
    const decale = (dx: number): Record<string, number[]> =>
      Object.fromEntries(Object.entries(standing).map(([key, [x, y]]) => [key, [x! + dx, y!]]));
    expect(
      validate(baseAnimation({ frames: [{ joints: standing }, { joints: decale(63) }] })).valid,
    ).toBe(true);
  });

  it('refuse une teleportation entre deux images', () => {
    const decale = (dx: number): Record<string, number[]> =>
      Object.fromEntries(Object.entries(standing).map(([key, [x, y]]) => [key, [x! + dx, y!]]));
    const result = validate(
      baseAnimation({
        frames: [{ joints: standing }, { joints: decale(2) }, { joints: decale(200) }],
      }),
    );
    expect(result.valid).toBe(false);
    expect(result.issues.some((issue) => issue.message.includes('saute'))).toBe(true);
  });

  it('surveille aussi le retour de la derniere image a la premiere', () => {
    const decale = (dx: number): Record<string, number[]> =>
      Object.fromEntries(Object.entries(standing).map(([key, [x, y]]) => [key, [x! + dx, y!]]));
    const result = validate(
      baseAnimation({
        frames: [{ joints: standing }, { joints: decale(60) }, { joints: decale(120) }],
      }),
    );
    expect(result.valid).toBe(false);
    expect(result.issues.some((issue) => issue.path === 'frames[2]')).toBe(true);
  });
});
